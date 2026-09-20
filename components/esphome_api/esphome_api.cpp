#include "esphome_api.hpp"
#include "esphome_proto.hpp"
#include "IoRtsManager.hpp"

#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include <string.h>
#include <stdint.h>
#include <algorithm>

static const char *TAG = "esphome";
static const int   PORT        = 6053;
static const int   MAX_CLIENTS = 4;
static const int   RECV_BUF    = 512;

// ── FNV-1a key ───────────────────────────────────────────────────────────────
static uint32_t fnv1a(const char *s) {
    uint32_t h = 2166136261u;
    while (*s) { h ^= (uint8_t)*s++; h *= 16777619u; }
    return h;
}
// Derive a stable entity key from device ID string (lowercase "cover_<id>")
static uint32_t cover_key(const char *device_id) {
    char tmp[32]; snprintf(tmp, sizeof(tmp), "cover_%s", device_id);
    // lowercase
    for (char *p = tmp; *p; p++) if (*p >= 'A' && *p <= 'Z') *p += 32;
    return fnv1a(tmp);
}

// ── Client state ─────────────────────────────────────────────────────────────
struct EsphomeClient {
    int  sock       = -1;
    bool connected  = false;   // after valid ConnectRequest
    bool subscribed = false;   // after SubscribeStatesRequest
};

static EsphomeClient        s_clients[MAX_CLIENTS];
static SemaphoreHandle_t    s_mutex;
static IoRts::IoRtsManager *s_manager = nullptr;

// ── Frame framing ─────────────────────────────────────────────────────────────
static bool send_frame(int sock, uint32_t msg_type, const ProtoWriter &pw) {
    // preamble 0x00, length varint, type varint, payload
    std::vector<uint8_t> frame;
    frame.push_back(0x00);

    size_t payload_len = pw.size();
    // encode length = payload_len (varint) into tmp
    uint8_t tmp[10]; int tmp_len = 0;
    uint64_t v = payload_len;
    do { tmp[tmp_len++] = (v & 0x7F) | (v >> 7 ? 0x80 : 0); v >>= 7; } while (v);
    for (int i = 0; i < tmp_len; i++) frame.push_back(tmp[i]);

    // encode type varint
    tmp_len = 0; v = msg_type;
    do { tmp[tmp_len++] = (v & 0x7F) | (v >> 7 ? 0x80 : 0); v >>= 7; } while (v);
    for (int i = 0; i < tmp_len; i++) frame.push_back(tmp[i]);

    // payload
    for (size_t i = 0; i < payload_len; i++) frame.push_back(pw.data()[i]);

    int sent = send(sock, frame.data(), frame.size(), 0);
    return sent == (int)frame.size();
}

static bool recv_varint(int sock, uint64_t *out) {
    uint64_t result = 0; int shift = 0;
    while (true) {
        uint8_t b;
        if (recv(sock, &b, 1, MSG_WAITALL) != 1) return false;
        result |= uint64_t(b & 0x7F) << shift;
        if (!(b & 0x80)) { *out = result; return true; }
        shift += 7;
        if (shift >= 64) return false;
    }
}

// recv_frame: reads one complete ESPHome frame into buf.
// Returns true and sets *msg_type and *len; false on disconnect or error.
static bool recv_frame(int sock, uint32_t *msg_type, uint8_t *buf, size_t *len, size_t max_len) {
    // preamble
    uint8_t preamble;
    if (recv(sock, &preamble, 1, MSG_WAITALL) != 1) return false;
    if (preamble == 0x01) {
        // Noise-encrypted — not supported; caller should close
        *msg_type = 0xFFFFFFFF; *len = 0; return true; // sentinel
    }
    if (preamble != 0x00) return false;

    uint64_t payload_len, type;
    if (!recv_varint(sock, &payload_len)) return false;
    if (!recv_varint(sock, &type))        return false;
    if (payload_len > max_len) return false;

    *msg_type = (uint32_t)type;
    *len      = (size_t)payload_len;

    if (payload_len > 0) {
        int got = recv(sock, buf, payload_len, MSG_WAITALL);
        if (got != (int)payload_len) return false;
    }
    return true;
}

// ── Message handler stub (filled in Task 3) ──────────────────────────────────
static void handle_message(EsphomeClient &c, uint32_t msg_type, const uint8_t *buf, size_t len) {
    (void)c; (void)buf; (void)len;
    ESP_LOGD(TAG, "msg_type=%u (stub)", msg_type);
}

// ── Server task ───────────────────────────────────────────────────────────────
static void server_task(void *) {
    int listen_sock = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr = {};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons(PORT);
    bind(listen_sock, (struct sockaddr *)&addr, sizeof(addr));
    listen(listen_sock, MAX_CLIENTS);
    ESP_LOGI(TAG, "ESPHome API server listening on port %d", PORT);

    while (true) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(listen_sock, &read_fds);
        int max_fd = listen_sock;

        xSemaphoreTake(s_mutex, portMAX_DELAY);
        for (auto &c : s_clients) {
            if (c.sock >= 0) { FD_SET(c.sock, &read_fds); if (c.sock > max_fd) max_fd = c.sock; }
        }
        xSemaphoreGive(s_mutex);

        struct timeval tv = {1, 0};
        int r = select(max_fd + 1, &read_fds, nullptr, nullptr, &tv);
        if (r <= 0) continue;

        // New connection
        if (FD_ISSET(listen_sock, &read_fds)) {
            int new_sock = accept(listen_sock, nullptr, nullptr);
            if (new_sock >= 0) {
                int yes = 1;
                setsockopt(new_sock, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
                struct timeval t = {5, 0};
                setsockopt(new_sock, SOL_SOCKET, SO_RCVTIMEO, &t, sizeof(t));
                setsockopt(new_sock, SOL_SOCKET, SO_SNDTIMEO, &t, sizeof(t));
                xSemaphoreTake(s_mutex, portMAX_DELAY);
                bool placed = false;
                for (auto &c : s_clients) {
                    if (c.sock < 0) { c.sock = new_sock; c.connected = false; c.subscribed = false; placed = true; break; }
                }
                xSemaphoreGive(s_mutex);
                if (!placed) { close(new_sock); ESP_LOGW(TAG, "Max clients reached"); }
                else ESP_LOGI(TAG, "Client connected, sock=%d", new_sock);
            }
        }

        // Readable clients — dispatch handled in Task 3
        xSemaphoreTake(s_mutex, portMAX_DELAY);
        for (auto &c : s_clients) {
            if (c.sock >= 0 && FD_ISSET(c.sock, &read_fds)) {
                uint8_t buf[RECV_BUF]; size_t len; uint32_t msg_type;
                if (!recv_frame(c.sock, &msg_type, buf, &len, sizeof(buf))) {
                    ESP_LOGI(TAG, "Client disconnected sock=%d", c.sock);
                    close(c.sock); c.sock = -1; c.connected = false; c.subscribed = false;
                    continue;
                }
                handle_message(c, msg_type, buf, len);
            }
        }
        xSemaphoreGive(s_mutex);
    }
}

void esphome_api_start(void *io_rts_manager) {
    s_manager = static_cast<IoRts::IoRtsManager *>(io_rts_manager);
    s_mutex   = xSemaphoreCreateMutex();
    for (auto &c : s_clients) c.sock = -1;
    xTaskCreate(server_task, "esphome_api", 6144, nullptr, 3, nullptr);
}

void esphome_api_notify_cover_state(const char *device_id, float position, bool is_moving) {
    (void)cover_key(device_id); (void)position; (void)is_moving;
    // Implemented in Task 4
}

void esphome_api_notify_cover_removed(const char *device_id) {
    (void)cover_key(device_id);
    // Implemented in Task 4
}
