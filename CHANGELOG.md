# Changelog

## [Unreleased] — stability and restart diagnostics

### Fixed
- **Log forwarding could exhaust the heap.** Lines logged by the web server task itself (socket/TLS read and write errors, WebSocket send failures) were forwarded to the browser over that same connection; when the browser went away without closing (laptop lid closed with the log page open) every failure produced a new line to send. On an ESP32 without PSRAM this ended with 12 KB free / 4 KB largest block for 40 hours: radio still running, web UI and MQTT unreachable. Such lines now only go to the serial console; while memory is low (free < 16 KB or largest block < 8 KB) no log lines are forwarded to the browser, syslog or the MQTT log topic (device state, positions and discovery are always sent); and at most 8 WebSocket messages wait for the web server at a time.
- **Pairing log no longer needs ~40 KB of heap.** Once it reached 500 lines, every new entry re-read the whole file and reserved ~40 KB of contiguous memory to drop the oldest line, which fails on boards with little free heap. The log is now a ring of 8 parts of < 4 KB (one LittleFS block each, 32 KB total); when the newest part is full the oldest part is dropped, so at most 1/8 of the history goes at a time. Download and the web UI still get one file, oldest first. A large log from older firmware is split into parts on the first new entry.
- **Radio log lines appeared twice in the web log**: the radio logger sent each line itself and it also arrived through the ESP log hook.
- **Controller settings could not save TX power or passive mode from the web UI**: the form sent `"17"` and `"on"` as strings, which the firmware ignores. It now sends a number and a boolean.

### Added
- **Restart diagnostics** (Settings → System → Uptime, and `/api/info`): uptime, why the board last started (power on, reset button, restart, crash, watchdog, brownout, out of memory), the number of starts, and — unless the power was cut — how long the previous run lasted, its lowest free heap and its first failed memory allocation (size, task, time). Kept in RTC memory and NVS, no extra heap.
- The pairing-log `BOOT` line includes the start number, reason and previous-run data, and is written once the clock is set (max. 60 s wait), so it gets a real timestamp instead of `boot+6s`.
- `HEAP` lines in the pairing log (uptime, free, lowest, largest block, failed allocations, open WebSocket clients and sockets): 10 minutes after start, then when memory changes noticeably and at least once a day. The first failed allocation of a run is logged right away (`OOM first: …`).
- **Memory watchdog**: when the largest free heap block stays below 8 KB for 5 minutes the board logs `LOWMEM restart` and restarts itself (reset reason `low_memory`), instead of staying unreachable until reset by hand.

## [Unreleased] — fix/web-ui-polish

### Fixed

#### Build
- **LittleFS partition overflow** — `CMakeLists.txt` now clears `web_staged/` before each reconfigure, preventing stale JS hash files and old web UI assets from accumulating and pushing the 450 KB LittleFS partition to capacity. Previously this caused mid-transfer TCP drops when serving assets.

#### Web UI — correctness
- **OTA key guard** — upload flows (firmware, web, pairing, remote wizard) now bail early with a user-visible error when the OTA key is not yet available, instead of sending an empty key.
- **OTA key input** — changed from `type="text"` to `type="password"` so the key is masked by default.
- **`r.ok` checks** — all `fetch()` calls that were missing a response-ok check (OTA key save, fallback AP, pairing start) now throw on non-2xx so the error toast fires correctly.
- **`FirmwareUpdater`** — added `TypeError` catch for the ESP32 TCP drop on reboot during OTA so the progress flow completes cleanly.
- **WiFi form** — password field is omitted from the POST body when left blank (prevents overwriting a saved password with an empty string); scan result keys are now stable (`ssid-idx`) to avoid Preact reconciliation warnings.
- **Network form** — added `name=` attributes on all inputs; added missing `dns2` field; DHCP state initialises from API data via `useEffect`; SNTP field is no longer incorrectly disabled when DHCP is on.
- **Backup** — `data?.success ?? true` default no longer incorrectly styles a fresh (no-data) state as an error.
- **IoSystemKey** — fixed stale closure in unmount cleanup by holding the OTA key in a `useRef`.
- **SoftwareUpdate** — removed non-functional "Check" button and raw i18n key `button.stable-only`.
- **Snapshot CI** — tag sanitisation (`/` → `-`) is now applied and exported via `GITHUB_ENV` in all three board jobs (heltec, t3s3, lora32); upload-artifact paths use the sanitised tag.

#### Web UI — flicker / performance
- **`useApi` flicker** — loading state is only reset when no cached data exists, so navigating back to a page shows the previous data instantly instead of a blank screen.
- **API response cache** — module-level `apiCache` in `useApi` survives component unmount/remount; pages restore from cache immediately on re-navigation.
- **i18n translation cache** — module-level `langCache` in `useI18n` means translation files are fetched once per session; subsequent mounts show translated text immediately without a key-flash.

#### Web UI — UX
- **MQTT status** — `useMqttConfig` now polls every 10 seconds so the connected/disconnected status stays live without a page reload.
- **Scroll outside layout** — wheel events on the margins outside the 600 px centred layout are now forwarded to `<main>`, so scrolling works anywhere on the page on wide desktops.
- **Missing i18n keys** — added `label.not-available`, `toast.syslog-saved`, and `toast.error-saving-syslog` to all four language files (en, nl, de, fr); these were previously showing their raw key strings.
