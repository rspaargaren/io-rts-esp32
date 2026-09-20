#include "esphome_api.hpp"
#include "esphome_proto.hpp"
#include "IoRtsManager.hpp"

#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "mdns.h"
#include "esp_log.h"
#include "esp_app_desc.h"
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include <string.h>
#include <stdint.h>
#include <algorithm>
#include <vector>

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

static void device_object_id(const char *device_id, char *out, size_t len) {
    snprintf(out, len, "io_%s", device_id);
    for (char *p = out; *p; p++) if (*p >= 'A' && *p <= 'Z') *p += 32;
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

// ── Message helpers ───────────────────────────────────────────────────────────
static void get_mac_str(char *out, size_t len) {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, len, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void send_hello_response(int sock) {
    ProtoWriter pw;
    pw.write_varint(1, 1);              // api_version_major
    pw.write_varint(2, 10);             // api_version_minor
    pw.write_string(3, "io-rts-esp32"); // server_info
    pw.write_string(4, "io-rts-esp32"); // name
    send_frame(sock, 2, pw);
}

static void send_connect_response(int sock) {
    ProtoWriter pw;
    pw.write_bool(1, false);  // invalid_password = false
    send_frame(sock, 4, pw);
}

static void send_disconnect_response(int sock) {
    ProtoWriter pw;
    send_frame(sock, 6, pw);  // empty payload
}

static void send_ping_response(int sock) {
    ProtoWriter pw;
    send_frame(sock, 8, pw);  // empty payload
}

static void send_device_info_response(int sock) {
    ProtoWriter pw;
    pw.write_bool  (1, false);
    pw.write_string(2, "io-rts-esp32");
    char mac[20]; get_mac_str(mac, sizeof(mac));
    pw.write_string(3, mac);
    pw.write_string(4, "2024.1.0");     // esphome_version (static)
    pw.write_string(5, "");             // compilation_time
    pw.write_string(6, "io-rts-esp32"); // model
    pw.write_string(8, "io-rts-esp32"); // project_name
    const esp_app_desc_t *app = esp_app_get_description();
    pw.write_string(9, app ? app->version : "unknown");
    send_frame(sock, 10, pw);
}

// ── Cover state ───────────────────────────────────────────────────────────────
// position_pct: 0.0 = open, 100.0 = closed (device convention)
// HA convention: 1.0 = fully open, 0.0 = fully closed → invert
static void send_cover_state_to(int sock, const char *device_id, float position_pct, bool is_moving) {
    float pos_ha = 1.0f - (position_pct / 100.0f);  // invert: our 0 (open) → HA 1.0
    uint32_t key = cover_key(device_id);
    ProtoWriter pw;
    pw.write_fixed32(1, key);
    pw.write_varint (2, pos_ha > 0.5f ? 0 : 1);   // legacy_state 0=OPEN 1=CLOSED
    pw.write_float  (3, pos_ha);                    // position 0.0–1.0
    pw.write_varint (5, is_moving ? 1 : 0);         // current_operation 0=IDLE 1=OPENING/CLOSING
    send_frame(sock, 22, pw);
}

// ── Entity listing ────────────────────────────────────────────────────────────
// Sends one ListEntitiesCoverResponse per device, then ListEntitiesDoneResponse.
// Called without any lock held; sock and devices are pre-captured by the caller.
static void send_list_entities(int sock, const std::vector<std::pair<std::string,std::string>> &devices) {
    for (auto &[id, name] : devices) {
        char obj_id[32];
        device_object_id(id.c_str(), obj_id, sizeof(obj_id));
        ProtoWriter pw;
        pw.write_string(1, obj_id);
        pw.write_fixed32(2, cover_key(id.c_str()));
        pw.write_string(3, name.c_str());
        pw.write_string(4, obj_id);         // unique_id
        pw.write_string(5, "mdi:blinds");   // icon
        pw.write_bool  (6, false);          // assumed_state
        pw.write_bool  (7, true);           // supports_position
        pw.write_bool  (8, false);          // supports_tilt
        pw.write_string(9, "shutter");      // device_class
        send_frame(sock, 13, pw);
    }
    ProtoWriter done;
    send_frame(sock, 19, done);
}

// ── Message handler ───────────────────────────────────────────────────────────
static void handle_message(EsphomeClient &c, uint32_t msg_type, const uint8_t *buf, size_t len) {
    if (msg_type == 0xFFFFFFFF) {   // Noise-encrypted — close
        close(c.sock); c.sock = -1; c.connected = false; c.subscribed = false;
        return;
    }
    switch (msg_type) {
    case 1:  // HelloRequest — respond even before ConnectRequest
        send_hello_response(c.sock);
        break;
    case 3:  // ConnectRequest — we accept any password
        c.connected = true;
        send_connect_response(c.sock);
        break;
    case 5:  // DisconnectRequest
        send_disconnect_response(c.sock);
        close(c.sock); c.sock = -1; c.connected = false; c.subscribed = false;
        break;
    case 7:  // PingRequest
        send_ping_response(c.sock);
        break;
    case 9:  // DeviceInfoRequest
        if (c.connected) send_device_info_response(c.sock);
        break;
    case 11:  // ListEntitiesRequest
        if (!c.connected) break;
        {
            // Deadlock-safe pattern: release s_mutex BEFORE taking mIoDevicesMutex.
            // Task 6 notify_cover_state is called while mIoDevicesMutex is held and then
            // takes s_mutex (order: mIoDevicesMutex → s_mutex). Holding s_mutex and then
            // taking mIoDevicesMutex would be the reverse order → deadlock.
            int sock = c.sock;
            xSemaphoreGive(s_mutex);          // release s_mutex first
            std::vector<std::pair<std::string,std::string>> devices;
            if (s_manager) {
                std::lock_guard<std::mutex> g(s_manager->mIoDevicesMutex);
                for (auto &kv : s_manager->mIoDevices)
                    devices.push_back({kv.first, iohome::device_display_name(kv.second)});
            }
            send_list_entities(sock, devices);
            xSemaphoreTake(s_mutex, portMAX_DELAY);  // re-acquire
        }
        break;
    case 20:  // SubscribeStatesRequest
        if (!c.connected) break;
        {
            // Deadlock-safe: snapshot under mIoDevicesMutex only after releasing s_mutex
            // (mIoDevicesMutex → s_mutex order; holding s_mutex and taking mIoDevicesMutex
            //  would be the reverse order → deadlock with Task-6 notify path)
            std::vector<std::tuple<std::string, float, bool>> snapshot;
            {
                xSemaphoreGive(s_mutex);
                if (s_manager) {
                    std::lock_guard<std::mutex> g(s_manager->mIoDevicesMutex);
                    for (auto &kv : s_manager->mIoDevices) {
                        float pos = kv.second.position;
                        if (pos == iohome::UNKNOWN_POSITION) pos = 50.0f;
                        bool moving = (kv.second.move_start_us != 0);
                        snapshot.push_back({kv.first, pos, moving});
                    }
                }
                xSemaphoreTake(s_mutex, portMAX_DELAY);
            }
            int sock = c.sock;
            c.subscribed = true;
            xSemaphoreGive(s_mutex);
            for (auto &[id, pos, moving] : snapshot)
                send_cover_state_to(sock, id.c_str(), pos, moving);
            xSemaphoreTake(s_mutex, portMAX_DELAY);
        }
        break;
    case 30: {  // CoverCommandRequest
        if (!c.connected || !s_manager) break;
        ProtoReader pr(buf, len);
        uint32_t key = 0;
        bool     has_pos = false, stop = false, has_legacy = false;
        float    pos_ha = 0.0f;
        uint64_t legacy_cmd = 0;
        uint32_t field, wire; uint64_t uv;
        while (pr.read_tag(&field, &wire)) {
            switch (field) {
            case 1: { uint32_t v; pr.read_fixed32(&v); key = v; break; }
            case 2: pr.read_varint(&uv); has_legacy = (bool)uv; break;
            case 3: pr.read_varint(&legacy_cmd); break;
            case 4: pr.read_varint(&uv); has_pos = (bool)uv; break;
            case 5: { uint32_t bits; pr.read_fixed32(&bits); memcpy(&pos_ha, &bits, 4); break; }
            case 8: pr.read_varint(&uv); stop = (bool)uv; break;
            default: pr.skip(wire); break;
            }
        }
        // Find device by key — release s_mutex before locking mIoDevicesMutex
        std::string target_id;
        {
            xSemaphoreGive(s_mutex);
            {
                std::lock_guard<std::mutex> g(s_manager->mIoDevicesMutex);
                for (auto &kv : s_manager->mIoDevices)
                    if (cover_key(kv.first.c_str()) == key) { target_id = kv.first; break; }
            }
            xSemaphoreTake(s_mutex, portMAX_DELAY);
        }
        if (target_id.empty()) {
            ESP_LOGW(TAG, "CoverCommand: unknown key %08X", (unsigned)key);
            break;
        }
        // Dispatch — SetDevicePosition/StopDevice do not need s_mutex
        xSemaphoreGive(s_mutex);
        if (stop || (has_legacy && legacy_cmd == 2)) {
            s_manager->StopDevice(target_id);
        } else if (has_pos) {
            // HA pos: 1.0=open, 0.0=closed → device: 0=open, 100=closed
            s_manager->SetDevicePosition(target_id, (uint8_t)((1.0f - pos_ha) * 100.0f));
        } else if (has_legacy) {
            if (legacy_cmd == 0) s_manager->SetDevicePosition(target_id, 0);    // OPEN
            if (legacy_cmd == 1) s_manager->SetDevicePosition(target_id, 100);  // CLOSE
        }
        xSemaphoreTake(s_mutex, portMAX_DELAY);
        break;
    }
    default:
        ESP_LOGD(TAG, "Unhandled msg_type=%u len=%u", msg_type, (unsigned)len);
        break;
    }
    (void)buf;
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
    mdns_service_add(NULL, "_esphomelib", "_tcp", PORT, NULL, 0);
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

        // Phase 1: brief lock — snapshot which sockets need reading
        std::vector<std::pair<int,int>> to_read;
        xSemaphoreTake(s_mutex, portMAX_DELAY);
        for (int i = 0; i < MAX_CLIENTS; i++) {
            if (s_clients[i].sock >= 0 && FD_ISSET(s_clients[i].sock, &read_fds)) {
                to_read.push_back({s_clients[i].sock, i});
            }
        }
        xSemaphoreGive(s_mutex);  // release BEFORE blocking reads

        // Phase 2 + 3: blocking recv per socket, then brief lock to update state
        for (auto &[sock, idx] : to_read) {
            uint8_t buf[RECV_BUF]; size_t len; uint32_t msg_type;
            bool ok = recv_frame(sock, &msg_type, buf, &len, sizeof(buf));

            xSemaphoreTake(s_mutex, portMAX_DELAY);
            if (s_clients[idx].sock != sock) { xSemaphoreGive(s_mutex); continue; } // client changed
            if (!ok) {
                ESP_LOGI(TAG, "Client disconnected sock=%d", sock);
                close(sock); s_clients[idx].sock = -1;
                s_clients[idx].connected = false; s_clients[idx].subscribed = false;
            } else {
                handle_message(s_clients[idx], msg_type, buf, len);
            }
            xSemaphoreGive(s_mutex);
        }
    }
}

void esphome_api_start(void *io_rts_manager) {
    s_manager = static_cast<IoRts::IoRtsManager *>(io_rts_manager);
    s_mutex   = xSemaphoreCreateMutex();
    for (auto &c : s_clients) c.sock = -1;
    xTaskCreate(server_task, "esphome_api", 6144, nullptr, 3, nullptr);
}

void esphome_api_notify_cover_state(const char *device_id, float position, bool is_moving) {
    if (!s_mutex) return;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(10)) != pdTRUE) return; // skip if contested
    for (auto &c : s_clients) {
        if (c.sock >= 0 && c.connected && c.subscribed)
            send_cover_state_to(c.sock, device_id, position, is_moving);
    }
    xSemaphoreGive(s_mutex);
}

void esphome_api_notify_cover_removed(const char *device_id) {
    (void)device_id;  // HA handles missing state updates gracefully
}
