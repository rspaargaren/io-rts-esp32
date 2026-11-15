// Restart diagnostics — see include/boot_info.h.

#include "boot_info.h"

#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "esp_attr.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"

#include "pair_log.h"
#include "web_server.h"

static const char *TAG = "boot_info";

#define BOOT_INFO_MAGIC 0x10B00721u // changed whenever rtc_record_t changes

// HEAP lines in the pairing log: a baseline 10 minutes after start, then only when memory
// changes noticeably (checked every minute), and at least once a day as a sign of life. An
// hourly line filled the 32 KB log in about two weeks and pushed real events out.
#define HEAP_LOG_FIRST_S      600
#define HEAP_LOG_CHECK_S      60
#define HEAP_LOG_HEARTBEAT_S  86400
#define HEAP_LOG_DELTA_FREE   (8 * 1024) // free heap or largest block moved this much
#define HEAP_LOG_DELTA_MIN    (4 * 1024) // lowest free heap dropped this much

// Memory watchdog: when the largest free block stays below this for LOWMEM_RESTART_S, the board
// restarts itself. HTTPS and MQTT need far bigger blocks, so the board would otherwise stay
// unreachable (seen: 40 hours with a 4 KB largest block) while the radio keeps running.
#define LOWMEM_LARGEST_BLOCK (8 * 1024)
#define LOWMEM_RESTART_S     300

#define RESTART_CAUSE_NONE   0u
#define RESTART_CAUSE_LOWMEM 0x4C4F574Du // "LOWM"

// Survives software restarts, crashes, watchdog resets and the reset button; garbage after a
// power cut, hence the magic + check value (the reset reason alone can't tell these apart: on an
// ESP32 the reset button also reports "power on").
typedef struct {
    uint32_t magic;
    uint32_t uptime_s;
    uint32_t heap_min;
    uint32_t restart_cause;  // set just before a deliberate restart by this module
    // First failed memory allocation in this run (written by the heap's failure hook)
    uint32_t fail_count;
    uint32_t fail_size;
    uint32_t fail_free;
    uint32_t fail_uptime_s;
    char fail_task[BOOT_INFO_TASK_NAME_LEN];
    uint32_t check;
} rtc_record_t;

static RTC_NOINIT_ATTR rtc_record_t s_rtc;

static boot_info_t s_info = {};
static bool s_logged = false;
static uint32_t s_next_heap_check_s = HEAP_LOG_FIRST_S;
static bool s_heap_logged = false;
static uint32_t s_heap_logged_at_s = 0;
static uint32_t s_heap_logged_free = 0;
static uint32_t s_heap_logged_largest = 0;
static uint32_t s_heap_logged_min = 0;
static uint32_t s_heap_logged_fails = 0;

static uint32_t abs_diff(uint32_t a, uint32_t b)
{
    return a > b ? a - b : b - a;
}
static bool s_first_fail_logged = false;
static uint32_t s_lowmem_since_s = 0;

static uint32_t record_check(const rtc_record_t *r)
{
    const uint32_t *w = (const uint32_t *)r;
    uint32_t h = 0x5A5A5A5Au;
    for (size_t i = 0; i < offsetof(rtc_record_t, check) / sizeof(uint32_t); i++)
        h = (h ^ w[i]) * 16777619u;
    return h;
}

static const char *reason_code(esp_reset_reason_t r)
{
    switch (r)
    {
    case ESP_RST_POWERON:   return "power_on";
    case ESP_RST_EXT:       return "external";
    case ESP_RST_SW:        return "software";
    case ESP_RST_PANIC:     return "crash";
    case ESP_RST_INT_WDT:   return "interrupt_watchdog";
    case ESP_RST_TASK_WDT:  return "task_watchdog";
    case ESP_RST_WDT:       return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT:  return "brownout";
    case ESP_RST_SDIO:      return "sdio";
    default:                return "unknown";
    }
}

uint32_t boot_info_uptime_s(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000000LL);
}

// Called by the heap allocator whenever an allocation fails. Must not allocate or block.
static void alloc_failed_hook(size_t size, uint32_t caps, const char *function_name)
{
    (void)caps;
    (void)function_name;
    if (s_rtc.fail_count++ > 0)
    {
        s_rtc.check = record_check(&s_rtc);
        return; // keep the details of the first failure: that is where it started
    }
    s_rtc.fail_size = (uint32_t)size;
    s_rtc.fail_free = (uint32_t)heap_caps_get_free_size(MALLOC_CAP_DEFAULT);
    s_rtc.fail_uptime_s = (uint32_t)(esp_timer_get_time() / 1000000LL);
    const char *name = "?";
    if (!xPortInIsrContext() && xTaskGetSchedulerState() != taskSCHEDULER_NOT_STARTED)
    {
        const char *n = pcTaskGetName(nullptr);
        if (n)
            name = n;
    }
    strncpy(s_rtc.fail_task, name, sizeof(s_rtc.fail_task) - 1);
    s_rtc.fail_task[sizeof(s_rtc.fail_task) - 1] = '\0';
    s_rtc.check = record_check(&s_rtc);
}

void boot_info_init(void)
{
    esp_reset_reason_t r = esp_reset_reason();
    s_info.reason = reason_code(r);

    if (s_rtc.magic == BOOT_INFO_MAGIC && s_rtc.check == record_check(&s_rtc))
    {
        if (r == ESP_RST_POWERON)
            s_info.reason = "reset_or_power_on"; // RTC memory intact: reset button, not a power cut
        if (r == ESP_RST_SW && s_rtc.restart_cause == RESTART_CAUSE_LOWMEM)
            s_info.reason = "low_memory";
        s_info.prev_valid = true;
        s_info.prev_uptime_s = s_rtc.uptime_s;
        s_info.prev_heap_min = s_rtc.heap_min;
        s_info.prev_fail_count = s_rtc.fail_count;
        if (s_rtc.fail_count > 0)
        {
            s_info.prev_fail_size = s_rtc.fail_size;
            s_info.prev_fail_free = s_rtc.fail_free;
            s_info.prev_fail_uptime_s = s_rtc.fail_uptime_s;
            memcpy(s_info.prev_fail_task, s_rtc.fail_task, sizeof(s_info.prev_fail_task));
            s_info.prev_fail_task[sizeof(s_info.prev_fail_task) - 1] = '\0';
        }
    }

    nvs_handle_t h;
    if (nvs_open("bootinfo", NVS_READWRITE, &h) == ESP_OK)
    {
        uint32_t n = 0;
        nvs_get_u32(h, "count", &n);
        s_info.boot_count = n + 1;
        nvs_set_u32(h, "count", s_info.boot_count);
        nvs_commit(h);
        nvs_close(h);
    }

    memset(&s_rtc, 0, sizeof(s_rtc));
    s_rtc.magic = BOOT_INFO_MAGIC;
    s_rtc.heap_min = (uint32_t)esp_get_free_heap_size();
    s_rtc.check = record_check(&s_rtc);

    heap_caps_register_failed_alloc_callback(alloc_failed_hook);

    if (s_info.prev_valid)
        ESP_LOGI(TAG, "Start #%u, reason %s, previous run %us, lowest free heap %u, failed allocations %u",
                 (unsigned)s_info.boot_count, s_info.reason, (unsigned)s_info.prev_uptime_s,
                 (unsigned)s_info.prev_heap_min, (unsigned)s_info.prev_fail_count);
    else
        ESP_LOGI(TAG, "Start #%u, reason %s", (unsigned)s_info.boot_count, s_info.reason);
}

void boot_info_sample(void)
{
    s_rtc.uptime_s = boot_info_uptime_s();
    s_rtc.heap_min = (uint32_t)esp_get_minimum_free_heap_size();
    s_rtc.check = record_check(&s_rtc);
}

uint32_t boot_info_fail_count(void)
{
    return s_rtc.fail_count;
}

void boot_info_memory_watchdog(void)
{
    uint32_t up = boot_info_uptime_s();
    size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT);

    // Log the first failed allocation as soon as it is seen (the details are in RTC memory)
    if (!s_first_fail_logged && s_rtc.fail_count > 0)
    {
        s_first_fail_logged = true;
        int ws = 0, sock = 0;
        web_server_connection_counts(&ws, &sock);
        char line[160];
        snprintf(line, sizeof(line), "OOM first: size=%uB task=%s free=%uB at=%us now_largest=%uB ws=%d sock=%d",
                 (unsigned)s_rtc.fail_size, s_rtc.fail_task, (unsigned)s_rtc.fail_free,
                 (unsigned)s_rtc.fail_uptime_s, (unsigned)largest, ws, sock);
        pair_log_append(line);
    }

    if (largest >= LOWMEM_LARGEST_BLOCK)
    {
        s_lowmem_since_s = 0;
        return;
    }
    if (s_lowmem_since_s == 0)
    {
        s_lowmem_since_s = up ? up : 1;
        ESP_LOGW(TAG, "Largest free block %u B — restarting in %d s unless memory recovers",
                 (unsigned)largest, LOWMEM_RESTART_S);
        return;
    }
    if (up - s_lowmem_since_s < LOWMEM_RESTART_S)
        return;

    int ws = 0, sock = 0;
    web_server_connection_counts(&ws, &sock);
    char line[160];
    snprintf(line, sizeof(line), "LOWMEM restart: free=%uB largest=%uB alloc_fail=%u ws=%d sock=%d",
             (unsigned)esp_get_free_heap_size(), (unsigned)largest, (unsigned)s_rtc.fail_count, ws, sock);
    pair_log_append(line); // may fail for lack of memory; the BOOT line will still say low_memory
    ESP_LOGE(TAG, "%s", line);
    s_rtc.uptime_s = up;
    s_rtc.heap_min = (uint32_t)esp_get_minimum_free_heap_size();
    s_rtc.restart_cause = RESTART_CAUSE_LOWMEM;
    s_rtc.check = record_check(&s_rtc);
    esp_restart();
}

bool boot_info_log_boot_when_ready(void)
{
    if (s_logged)
        return true;
    // Wait for SNTP so the entry gets a real timestamp, but don't wait forever (no internet)
    if (time(nullptr) < 1000000000L && boot_info_uptime_s() < 60)
        return false;

    char line[200];
    int n;
    if (s_info.prev_valid)
        n = snprintf(line, sizeof(line), "BOOT #%u reason=%s prev_uptime=%us prev_heap_min=%uKB",
                     (unsigned)s_info.boot_count, s_info.reason,
                     (unsigned)s_info.prev_uptime_s, (unsigned)(s_info.prev_heap_min / 1024));
    else
        n = snprintf(line, sizeof(line), "BOOT #%u reason=%s", (unsigned)s_info.boot_count, s_info.reason);
    if (s_info.prev_valid && s_info.prev_fail_count > 0 && n > 0 && n < (int)sizeof(line))
        snprintf(line + n, sizeof(line) - n, " alloc_fail=%u first=%uB task=%s free=%uB at=%us",
                 (unsigned)s_info.prev_fail_count, (unsigned)s_info.prev_fail_size, s_info.prev_fail_task,
                 (unsigned)s_info.prev_fail_free, (unsigned)s_info.prev_fail_uptime_s);
    pair_log_append(line);
    s_logged = true;
    return true;
}

void boot_info_log_heap_periodic(void)
{
    uint32_t up = boot_info_uptime_s();
    if (up < s_next_heap_check_s)
        return;
    s_next_heap_check_s = up + HEAP_LOG_CHECK_S;

    uint32_t free_b = (uint32_t)esp_get_free_heap_size();
    uint32_t min_b = (uint32_t)esp_get_minimum_free_heap_size();
    uint32_t largest = (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT);
    uint32_t fails = s_rtc.fail_count;

    if (s_heap_logged &&
        up - s_heap_logged_at_s < HEAP_LOG_HEARTBEAT_S &&
        abs_diff(free_b, s_heap_logged_free) < HEAP_LOG_DELTA_FREE &&
        abs_diff(largest, s_heap_logged_largest) < HEAP_LOG_DELTA_FREE &&
        s_heap_logged_min - min_b < HEAP_LOG_DELTA_MIN && // min only goes down
        fails == s_heap_logged_fails)
        return;

    s_heap_logged = true;
    s_heap_logged_at_s = up;
    s_heap_logged_free = free_b;
    s_heap_logged_largest = largest;
    s_heap_logged_min = min_b;
    s_heap_logged_fails = fails;

    int ws = 0, sock = 0;
    web_server_connection_counts(&ws, &sock);
    char line[136];
    snprintf(line, sizeof(line), "HEAP up=%us free=%uKB min=%uKB largest=%uKB alloc_fail=%u ws=%d sock=%d",
             (unsigned)up, (unsigned)(free_b / 1024), (unsigned)(min_b / 1024),
             (unsigned)(largest / 1024), (unsigned)fails, ws, sock);
    pair_log_append(line);
}

const boot_info_t *boot_info_get(void)
{
    return &s_info;
}
