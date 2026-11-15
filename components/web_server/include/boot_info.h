#pragma once

// Restart diagnostics: why the board last restarted, how long it had been running and how low
// its free memory went before that, plus a boot counter. Costs no heap: the "previous run" data
// lives in RTC memory that survives a restart (but not a power cut), the counter lives in NVS.
// Also records the last failed memory allocation (size + task) and writes an hourly memory
// line to the pairing log, so a slow leak shows up as a trend that survives the crash.

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BOOT_INFO_TASK_NAME_LEN 16

typedef struct {
    const char *reason;        ///< short code: power_on, reset_or_power_on, software, low_memory, crash, task_watchdog, ...
    uint32_t boot_count;       ///< number of starts since the counter was introduced
    bool prev_valid;           ///< false after a power cut (RTC memory is lost then)
    uint32_t prev_uptime_s;    ///< how long the previous run lasted (last sample, ≤ 5 s off)
    uint32_t prev_heap_min;    ///< lowest free heap seen during the previous run
    uint32_t prev_fail_count;  ///< failed memory allocations in the previous run
    uint32_t prev_fail_size;   ///< size of the first failed allocation (bytes)
    uint32_t prev_fail_free;   ///< free heap at that moment (bytes)
    uint32_t prev_fail_uptime_s; ///< when it happened (seconds after that start)
    char prev_fail_task[BOOT_INFO_TASK_NAME_LEN]; ///< task that asked for the memory
} boot_info_t;

/// @brief Read the reset reason and previous-run data. Call once, early in app_main.
void boot_info_init(void);

/// @brief Record uptime and minimum free heap in RTC memory. Call every few seconds.
void boot_info_sample(void);

/// @brief Writes the BOOT line to the pairing log once the clock is set (or after 60 s).
/// Call from a periodic loop; returns true once done.
bool boot_info_log_boot_when_ready(void);

/// @brief Writes a HEAP line to the pairing log 10 minutes after start, then whenever memory
/// changes noticeably and at least once a day. Call from a periodic loop.
void boot_info_log_heap_periodic(void);

/// @brief Logs the first failed allocation, and restarts the board when the largest free block
/// stays below 8 KB for 5 minutes. Call every few seconds.
void boot_info_memory_watchdog(void);

/// @brief Failed memory allocations in the current run.
uint32_t boot_info_fail_count(void);

const boot_info_t *boot_info_get(void);

/// @brief Seconds since this start.
uint32_t boot_info_uptime_s(void);

#ifdef __cplusplus
}
#endif
