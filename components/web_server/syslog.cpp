#include "syslog.h"
#include "SyslogConfig.hpp"
#include "sdkconfig.h"

#include <string.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <unistd.h>

#include "esp_log.h"

#if CONFIG_WEB_ENABLED

static const char *TAG = "syslog";

static int               s_sock      = -1;
static struct sockaddr_in s_dest     = {};
static char              s_hostname[64] = "io-rts-esp32";
static char              s_id[16]    = "io-rts-esp32";

// Cached config — updated by syslog_apply_config() to avoid NVS reads per line.
static bool     s_enabled   = false;
static uint8_t  s_facility  = 1;
static uint8_t  s_min_level = 7;

static uint8_t severity_from_esp_char(char c)
{
    switch (c) {
        case 'E': return 3;  // error
        case 'W': return 4;  // warning
        case 'I': return 6;  // info
        default:  return 7;  // debug / verbose
    }
}

void syslog_init(const char *hostname)
{
    if (hostname && *hostname)
        snprintf(s_hostname, sizeof(s_hostname), "%s", hostname);
    syslog_apply_config();
}

void syslog_apply_config(void)
{
    s_facility  = Config::SyslogConfig::GetFacility();
    s_min_level = Config::SyslogConfig::GetMinLevel();

    bool enabled = Config::SyslogConfig::isEnabled();
    if (!enabled) {
        // Disable: swap out socket first so syslog_send stops using it,
        // then close the old one safely.
        int old = s_sock;
        s_enabled = false;
        s_sock    = -1;
        if (old >= 0) close(old);
        return;
    }

    std::string server = Config::SyslogConfig::GetServer();
    if (server.empty()) {
        int old = s_sock;
        s_enabled = false;
        s_sock    = -1;
        if (old >= 0) close(old);
        return;
    }

    uint16_t port = Config::SyslogConfig::GetPort();

    // Resolve hostname/IP — blocking call, acceptable outside radio task.
    struct addrinfo hints = {};
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    char port_str[8];
    snprintf(port_str, sizeof(port_str), "%u", (unsigned)port);

    struct addrinfo *res = nullptr;
    if (getaddrinfo(server.c_str(), port_str, &hints, &res) != 0 || !res) {
        ESP_LOGW(TAG, "Cannot resolve syslog server '%s'", server.c_str());
        int old = s_sock;
        s_enabled = false;
        s_sock    = -1;
        if (old >= 0) close(old);
        return;
    }
    memcpy(&s_dest, res->ai_addr, sizeof(s_dest));
    freeaddrinfo(res);

    // Create and connect new socket BEFORE closing the old one.
    // This keeps the old socket valid for syslog_send until the new one is ready.
    int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (fd < 0) {
        ESP_LOGW(TAG, "Failed to create UDP socket");
        return;
    }
    if (connect(fd, (struct sockaddr *)&s_dest, sizeof(s_dest)) < 0) {
        ESP_LOGW(TAG, "UDP connect failed errno=%d", errno);
        close(fd);
        return;
    }

    // Atomic swap: install new socket, then close old one.
    int old = s_sock;
    s_sock    = fd;
    s_enabled = true;
    if (old >= 0) close(old);

    ESP_LOGI(TAG, "Syslog ready → %s:%u (facility=%u min_level=%u)",
             server.c_str(), (unsigned)port, (unsigned)s_facility, (unsigned)s_min_level);
}

bool syslog_is_active(void)
{
    return s_enabled && s_sock >= 0;
}

void syslog_set_id(const char *id)
{
    if (id && *id)
        snprintf(s_id, sizeof(s_id), "%s", id);
}

void syslog_send(const char *line)
{
    int fd = s_sock;  // local copy to avoid race with syslog_apply_config
    if (!s_enabled || fd < 0 || !line || !*line) return;

    uint8_t severity = severity_from_esp_char(line[0]);
    if (severity > s_min_level) return;  // below configured verbosity threshold

    uint8_t pri = (s_facility * 8) + severity;

    // Omit timestamp — let the syslog server stamp with reception time.
    // This avoids wrong timestamps when NTP hasn't synced yet.
    // Use as format the rfc5424 format with UTF-8 BOM to avoid issues with non-ASCII characters in the log line.
    char buf[256];
    int len = snprintf(buf, sizeof(buf), "<%u>1 - %s %s - - - \xEF\xBB\xBF%s",
                       (unsigned)pri, s_hostname, s_id, line);
    if (len <= 0) return;
    if (len >= (int)sizeof(buf)) len = (int)sizeof(buf) - 1;

    send(fd, buf, (size_t)len, 0);
}

#endif // CONFIG_WEB_ENABLED
