#include "pair_log.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include "esp_log.h"
#include "esp_http_server.h"

// The pairing log is kept in a ring of small files instead of one big file:
//
//   /devices/pairing_log.txt     current part, new lines are appended here
//   /devices/pairing_log.1.txt   previous part
//   ...
//   /devices/pairing_log.7.txt   oldest part
//
// When the current part would grow past PART_MAX_BYTES, every part moves up one place and
// the oldest one is dropped, so at most 1/8 of the history disappears at a time. Total size is
// bounded (8 x ~4 KB = 32 KB) and appending needs no more RAM than the line itself; the old
// implementation re-read the whole file and reserved ~40 KB of contiguous heap to trim it,
// which fails on boards with little free memory.
//
// A single large log left by older firmware is split into parts on the first append.
// Each part stays just under one LittleFS block (4 KB). The download stitches the parts
// together oldest first, so the user still gets a single pairing_log.txt.

static const char *TAG = "pair_log";
static const char *LOG_PATH = "/devices/pairing_log.txt"; // current part (same name as before)
static const int   PART_COUNT = 8;                        // current + 7 older parts
static const long  PART_MAX_BYTES = 3968;                 // just under one 4 KB LittleFS block
static const size_t COPY_CHUNK = 256;

static std::mutex s_lock; // appends come from the web server, radio and main tasks

/// Path of part n: 0 = current, 1..PART_COUNT-1 = older parts
static std::string part_path(int n)
{
    if (n == 0)
        return LOG_PATH;
    return "/devices/pairing_log." + std::to_string(n) + ".txt";
}

static long file_size(const char *path)
{
    struct stat st;
    return stat(path, &st) == 0 ? (long)st.st_size : -1;
}

static std::string timestamp_str()
{
    time_t now = time(nullptr);
    if (now < 1000000000L) {
        // Clock not synced — use uptime
        char buf[32];
        snprintf(buf, sizeof(buf), "boot+%llds", (long long)now);
        return buf;
    }
    struct tm tm_info;
    gmtime_r(&now, &tm_info);
    char buf[24];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_info);
    return buf;
}

/// Split a log written by older firmware (one file, up to ~40 KB) into parts, keeping the most
/// recent (PART_COUNT - 1) parts' worth. Streams line by line, so it needs no extra heap.
/// Afterwards the current part is absent.
static void split_legacy(long size)
{
    FILE *in = fopen(LOG_PATH, "r");
    if (!in) {
        remove(LOG_PATH);
        return;
    }
    long start = size - (long)(PART_COUNT - 1) * (PART_MAX_BYTES - 128); // margin for line ends
    if (start > 0) {
        fseek(in, start, SEEK_SET);
        int c;
        while ((c = fgetc(in)) != EOF && c != '\n') {
            // skip the partial first line
        }
    }

    // Write oldest first into temporary parts, then give them their final numbers
    char line[COPY_CHUNK];
    int parts = 0;
    long part_size = 0;
    FILE *out = nullptr;
    while (fgets(line, sizeof(line), in)) {
        long len = (long)strlen(line);
        if (!out || part_size + len > PART_MAX_BYTES) {
            if (out)
                fclose(out);
            if (parts == PART_COUNT - 1)
                break; // should not happen thanks to the margin above
            out = fopen(("/devices/pairing_log.tmp" + std::to_string(parts) + ".txt").c_str(), "w");
            parts++;
            part_size = 0;
            if (!out)
                break;
        }
        fputs(line, out);
        part_size += len;
    }
    if (out)
        fclose(out);
    fclose(in);
    remove(LOG_PATH);

    for (int k = 0; k < parts; k++) {
        std::string tmp = "/devices/pairing_log.tmp" + std::to_string(k) + ".txt";
        if (rename(tmp.c_str(), part_path(parts - k).c_str()) != 0)
            remove(tmp.c_str());
    }
}

/// Shift all parts up one place, dropping the oldest. Afterwards the current part is absent.
static void rotate(long current_size)
{
    if (current_size > PART_MAX_BYTES) {
        // One big log from older firmware (no older parts exist yet)
        for (int n = 1; n < PART_COUNT; n++)
            remove(part_path(n).c_str());
        split_legacy(current_size);
        return;
    }

    remove(part_path(PART_COUNT - 1).c_str());
    for (int n = PART_COUNT - 2; n >= 1; n--)
        rename(part_path(n).c_str(), part_path(n + 1).c_str()); // missing parts: harmless failure

    if (rename(LOG_PATH, part_path(1).c_str()) != 0) {
        ESP_LOGE(TAG, "Failed to rotate %s", LOG_PATH);
        remove(LOG_PATH);
    }
}

void pair_log_append(const char *entry)
{
    if (!entry || !*entry) return;

    std::string line = timestamp_str() + " " + entry + "\n";

    std::lock_guard<std::mutex> guard(s_lock);

    long size = file_size(LOG_PATH);
    if (size > 0 && size + (long)line.size() > PART_MAX_BYTES)
        rotate(size);

    FILE *f = fopen(LOG_PATH, "a");
    if (f) {
        fputs(line.c_str(), f);
        fclose(f);
    } else {
        ESP_LOGE(TAG, "Failed to open %s for append", LOG_PATH);
    }
}

esp_err_t pair_log_serve(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=\"pairing_log.txt\"");

    // Oldest part first. Not locked against appends: a rotation during a download can at worst
    // duplicate or skip a few lines in that download, and holding the lock while sending over a
    // slow connection would block the radio task.
    char buf[COPY_CHUNK];
    for (int n = PART_COUNT - 1; n >= 0; n--) {
        FILE *f = fopen(part_path(n).c_str(), "r");
        if (!f)
            continue;
        size_t len;
        esp_err_t err = ESP_OK;
        while (err == ESP_OK && (len = fread(buf, 1, sizeof(buf), f)) > 0)
            err = httpd_resp_send_chunk(req, buf, len);
        fclose(f);
        if (err != ESP_OK)
            return err; // client went away
    }
    httpd_resp_send_chunk(req, nullptr, 0); // end chunked response
    return ESP_OK;
}

esp_err_t pair_log_clear(httpd_req_t *req)
{
    {
        std::lock_guard<std::mutex> guard(s_lock);
        for (int n = 0; n < PART_COUNT; n++)
            remove(part_path(n).c_str());
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"status\":\"cleared\"}");
    return ESP_OK;
}
