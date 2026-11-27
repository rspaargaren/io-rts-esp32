#pragma once

#include "sdkconfig.h"

#ifdef __cplusplus
extern "C" {
#endif

#if CONFIG_WEB_ENABLED
void web_server_start(void *ioRtsManager);
void web_server_broadcast_position(const char *device_id, int position, bool is_stopped, bool estimated);
void web_server_broadcast_log(const char *message);
void web_server_broadcast_device_event(const char *device_id, const char *event_type);
void web_server_broadcast_message(const char *json_str);
void pair_log_append(const char *entry);
/// True when free heap or the largest free block is too low to forward log lines
bool web_server_memory_low(void);
/// Open WebSocket clients and open HTTP(S) sockets (for diagnostics)
void web_server_connection_counts(int *ws_clients, int *open_sockets);
#else
static inline void web_server_start(void *m) { (void)m; }
static inline void web_server_broadcast_position(const char *id, int pos, bool s, bool e) { (void)id; (void)pos; (void)s; (void)e; }
static inline void web_server_broadcast_log(const char *msg) { (void)msg; }
static inline void web_server_broadcast_device_event(const char *id, const char *t) { (void)id; (void)t; }
static inline void web_server_broadcast_message(const char *json) { (void)json; }
static inline void pair_log_append(const char *e) { (void)e; }
static inline bool web_server_memory_low(void) { return false; }
static inline void web_server_connection_counts(int *w, int *o) { if (w) *w = 0; if (o) *o = 0; }
#endif

#ifdef __cplusplus
}
#endif
