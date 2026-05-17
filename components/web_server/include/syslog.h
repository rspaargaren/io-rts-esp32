#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/// @brief Initialise the syslog client. Call once after WiFi is up.
/// @param hostname mDNS hostname used as the HOSTNAME field in RFC 3164 messages.
void syslog_init(const char *hostname);

/// @brief Send one pre-formatted ESP log line to the syslog server.
///        Must only be called from log_drain_task (priority 1) — never from
///        web_log_vprintf or any radio-task context.
/// @param line ANSI-stripped, newline-trimmed ESP log line.
void syslog_send(const char *line);

/// @brief Re-read SyslogConfig from NVS and reconnect the UDP socket.
///        Safe to call from console command or web API handler.
void syslog_apply_config(void);

/// @brief Returns true if syslog is currently active (socket open).
///        Safe to call from any context — reads a single bool.
bool syslog_is_active(void);

#ifdef __cplusplus
}
#endif
