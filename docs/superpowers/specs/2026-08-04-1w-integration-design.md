# 1W (Simplex) Device Support — Integration Design

**Date:** 2026-08-04
**Status:** Approved for implementation
**Reference implementation:** https://github.com/rspaargaren/iohomecontrol (1W logic, packet structs, crypto)
**Supersedes:** `docs/superpowers/specs/2026-06-06-1w-support-design.md`

---

## Goal

Add simplex (1W) io-homecontrol device pairing and control as an alternative to 2W, integrated into the existing codebase with maximum reuse of existing infrastructure. Users who cannot pair a device via 2W can use 1W instead. Both modes coexist; protocol mode is fixed at pairing time.

---

## 2W vs 1W comparison

| Aspect | 2W (existing) | 1W (new) |
|---|---|---|
| Direction | Bidirectional | TX only (simplex) |
| Frequency | CH1 + CH2 + CH3 hopping | CH2 only (868.95 MHz) |
| Authentication | Challenge-response + session key | Per-device AES-128 key + HMAC-SHA256 |
| Command target | Unicast to device node ID | Broadcast to `(type << 6) \| 0x3F` |
| Command repeats | 1× per channel (3 total) | 4× on CH2 (~40 ms apart via natural TX timing) |
| Position feedback | Real (from CMD 0x71 STATUS_UPDATE) | Software estimate only |
| Position tracking | `move_start_us` / `move_target_pos` + MQTT interpolation | Same fields, same timer — fully reused |
| Pairing | `DiscoverAndPairDevice` (device responds) | Broadcast PAIR + ADD (no reply) |
| Protocol mode | Fixed from first pairing — not switchable | Fixed from first pairing — not switchable |

**Broadcast command behaviour:** Because 1W commands are broadcast by device type, all 1W-paired devices of the same type receive every command. This is intentional — it enables group control without extra configuration, and only devices that hold the matching AES key will honour it.

---

## Architecture

### Principle: maximum reuse

| Layer | Reuse |
|---|---|
| Radio driver (`RadioSX1276`) | **Fully reused** — untouched |
| Frame TX path (`TransmitFrame`) | **Fully reused** — made public; `Io1WControl` calls it 4× |
| Frame format (`IoFrame`, `IoFrame` header) | **Fully reused** — 1W builds an `IoFrame` with 1W payload |
| Crypto primitives (`iohome_crypto`) | **Fully reused** — two 1W functions added to existing module |
| Position tracking fields (`move_start_us`, `move_target_pos`) | **Fully reused** — set by existing `arm_move` lambda |
| MQTT interpolation timer | **Fully reused** — fires for any device with `move_start_us != 0` |
| `TransitTime`, calibration API (`setTransitTime`) | **Fully reused** — 1W needs manual calibration; same API action |

### What is new

```
io-homecontrol/
  Io1WControl.hpp/.cpp    — 1W controller: pair, unpair, send; calls existing
                            TransmitFrame and iohome::crypto functions
```

`IoRtsManager` gains three dispatch methods and `mIo1W` member.

`web_server.cpp` command path gains a protocol dispatch and two new API actions.

### `IoHomeControl` change — one line only

`TransmitFrame` is moved from `private` to `public` in `IoHomeControl.hpp`. No other change to `IoHomeControl.hpp` or `IoHomeControl.cpp`.

`TransmitFrame` enqueues to the FreeRTOS `sTxIoQueue` (thread-safe by design) — `Io1WControl` needs no mutex of its own.

---

## Data model

Three fields added to `IoDeviceInformation` (the persisted static part of `IoDevice`):

```cpp
// iohome_device.hpp
enum class ProtocolMode : uint8_t { PROTO_2W = 0, PROTO_1W = 1 };

struct IoDeviceInformation {
    // ... all existing fields unchanged ...
    ProtocolMode protocol_mode = ProtocolMode::PROTO_2W;  // NEW
    uint16_t     sequence_1w   = 0;                       // NEW: rolling counter, persisted after every TX
    uint8_t      key_1w[AES_KEY_SIZE] = {};               // NEW: per-device AES key, generated at pair time
};
```

`DeviceStorage` JSON — three new keys, all optional (absent = 2W, backward-compatible):

```json
{
  "protocol": "1w",
  "sequence": "0042",
  "key_1w": "aabbccddeeff00112233445566778899"
}
```

`transit_time_ms` already exists in `StoredIoDevice` and is already persisted — no change needed.

---

## 1W protocol

### Pairing (no reply expected)

```
CMD 0x2E (PAIR):  src=our_node_id, dst=(type<<6)|0x3F
  payload: data=0x00 | seq[2] | hmac[6]

CMD 0x30 (ADD):   src=our_node_id, dst=(type<<6)|0x3F
  payload: enc_key[16] | manufacturer[1] | data=0x01 | seq[2]
  enc_key = aes128_encrypt(key_1w, transfer_key)
```

### Unpairing

```
CMD 0x39 (REMOVE): same structure as CMD 0x2E
```

### Command (open / close / position / stop)

```
CMD 0x20, broadcast to (type<<6)|0x3F
  payload: seq[2] | hmac[6] | main[2] | origin[1] | acei[1] | fp1[1]
  main = (100 - position_pct) * 2    (0 = full open, 200 = full closed on device scale)
```

Stop: send CMD 0x20 with current estimated position. Software-side `move_start_us` is cleared.

### Sequence counter

Initialised to a random non-zero value at first pairing. Incremented on every TX. Persisted to `DeviceStorage` after each send to survive resets and prevent replay attacks.

### Transfer key

The io-homecontrol 1W transfer key is a protocol constant used to encrypt the device AES key in the ADD packet. It is hardcoded in `Io1WControl.cpp` — it is not user-configurable and not the same as the system key.

---

## Crypto extensions

Two functions added to the **existing** `iohome_crypto.h/.cpp` — no new file:

```cpp
// iohome_crypto.h additions
namespace iohome { namespace crypto {

    /// Encrypt the per-device 1W key for inclusion in the ADD (0x30) packet.
    /// Uses AES-128 ECB with the protocol transfer key.
    bool encrypt_1w_key(
        const uint8_t key_1w[AES_KEY_SIZE],
        uint8_t enc_key_out[AES_KEY_SIZE]);

    /// Generate 6-byte HMAC for a 1W frame using HMAC-SHA256 (PSA API).
    bool create_1w_hmac(
        const uint8_t seq[2],
        const uint8_t key_1w[AES_KEY_SIZE],
        const uint8_t *frame, size_t frame_len,
        uint8_t hmac_out[HMAC_SIZE]);
}}
```

`encrypt_1w_key` calls the existing `aes128_encrypt()` with the hardcoded transfer key.
`create_1w_hmac` uses `psa_mac_compute(PSA_ALG_HMAC(PSA_ALG_SHA_256))` — same PSA API already initialised by the 2W code.

---

## Lower-layer TX

`Io1WControl::Send()` builds an `IoFrame`, then enqueues it 4 times:

```cpp
for (int i = 0; i < 4; i++)
    mIoHome->TransmitFrame(frame, FREQUENCY_CHANNEL_2, LONG_PREAMBLE_LENGTH);
```

`TransmitFrame` pushes to the FreeRTOS `sTxIoQueue` — thread-safe, no mutex needed in `Io1WControl`. The `process_radio_task` dequeues and sends each frame, yielding 5 ms between them. The ~40 ms repeat interval is achieved naturally: each TX takes ~34 ms (1024-bit preamble at 32 kbps + frame bytes) plus the 5 ms yield.

`Io1WControl` receives an `IoHomeControl*` pointer in its constructor. No other IoHomeControl accessor is needed.

---

## Position tracking

For 1W devices, the existing `arm_move` lambda in `web_server.cpp` sets `move_start_us`, `move_start_pos`, and `move_target_pos` — exactly as it does for 2W. The MQTT interpolation timer in `IoRtsManager` fires for any device with `move_start_us != 0`, publishing estimated position and open/opening/closing/closed state.

One change to `arm_move`: skip `ScheduleConfirmationPoll` for 1W devices (no response is expected):

```cpp
auto arm_move = [&](float target_pos) {
    // ... set move fields (unchanged) ...
    if (device.info.protocol_mode == ProtocolMode::PROTO_2W)
        s_manager->ScheduleConfirmationPoll(deviceId, tt, dist);
};
```

The MQTT interpolation timer marks `is_stopped = true` when `position ≈ target`, matching the existing 2W behaviour.

---

## Command dispatch

`IoRtsManager` gains three dispatch methods that replace the direct `mIoHome->` calls in `web_server.cpp`:

```cpp
// IoRtsManager — new public dispatch methods
bool OpenDevice(const std::string &deviceId, bool quiet);
bool CloseDevice(const std::string &deviceId, bool quiet);
bool SetDevicePosition(const std::string &deviceId, uint8_t position, bool quiet);
bool StopDevice(const std::string &deviceId);
```

Each method reads `protocol_mode` and routes to either `mIoHome` or `mIo1W`. `web_server.cpp` calls `s_manager->OpenDevice(...)` instead of `s_manager->mIoHome->OpenDevice(...)` — four call sites updated, no logic change.

---

## Implementation phases

### Phase 1 — Data model

**Files:** `iohome_device.hpp`, `helpers/DeviceStorage.cpp`

Add `ProtocolMode` enum and three fields to `IoDeviceInformation`. Add read/write of `protocol`, `sequence`, `key_1w` in `DeviceStorage`. All existing devices load as `PROTO_2W` with zero sequence and zero key.

**Check:** Build succeeds. Load/save round-trip of an existing `devices.json` unchanged.

→ Confirm before Phase 2.

---

### Phase 2 — Crypto extensions

**Files:** `protocol/iohome_crypto.h`, `protocol/iohome_crypto.cpp`

Add `encrypt_1w_key` and `create_1w_hmac`.

**Check:** Unit test via serial command (Phase 5 scaffold): given known inputs, output matches reference values from `iohcCryptoHelpers`.

→ Confirm before Phase 3.

---

### Phase 3 — `Io1WControl` class

**Files:** `io-homecontrol/Io1WControl.hpp/.cpp`, `io-homecontrol/IoHomeControl.hpp` (TransmitFrame + GetMutex public)

Implement `PairDevice(name, type, manufacturer)`, `UnpairDevice(id)`, `Send(device, position_pct)`. Packet building for CMD 0x2E, 0x30, 0x39, 0x20.

**Check:** Build succeeds. No 2W regressions (run existing 2W commands via serial).

→ Confirm before Phase 4.

---

### Phase 4 — `IoRtsManager` dispatch + `arm_move` update

**Files:** `main/IoRtsManager.hpp/.cpp`, `components/web_server/web_server.cpp`

Add `mIo1W`, dispatch methods, `Pair1WDevice`, `Unpair1WDevice`. Update four `mIoHome->` call sites in `web_server.cpp`. Update `arm_move` to skip `ScheduleConfirmationPoll` for 1W.

**Check:** 2W open/close/position still works. 2W `ScheduleConfirmationPoll` still fires. Build succeeds.

→ Confirm before Phase 5.

---

### Phase 5 — Serial test commands *(hardware validation gate)*

**Files:** `helpers/CmdLineIoTools.cpp`

```
pair1w <name> <type> <manufacturer>  — pair a 1W device (device must be in pairing mode)
unpair1w <id>                        — remove a 1W device
send1w <id> open|close|stop|<0-100> — send a 1W command
```

**Check (physical device required):**
1. Put a 1W device in pairing mode (hold prog button until LED blinks)
2. `pair1w TestBlind 2 1` — device LED acknowledges
3. `send1w <id> open` — device moves
4. `send1w <id> close` — device moves opposite
5. Set transit time via `curl -X POST .../api/action -d '{"action":"setTransitTime","deviceId":"<id>","transit_time_ms":30000}'`
6. `send1w <id> open` — check `/api/devices` response shows position animating
7. 2W command to a 2W device immediately after — must work without interference

→ User confirms hardware test before Phase 6.

---

### Phase 6 — Web server API

**Files:** `components/web_server/web_server.cpp`

New actions in `/api/action`:
- `pair1w` — triggers `IoRtsManager::Pair1WDevice(name, type, manufacturer)`
- `unpair1w` — triggers `IoRtsManager::Unpair1WDevice(deviceId)`

Extended `/api/devices` response — new fields per device:
```json
{
  "protocol": "1w",
  "position_estimated": true
}
```
`protocol` omitted (or `"2w"`) for 2W devices. `position_estimated` is `true` for 1W devices and `false` for 2W devices with a real position.

**Check:**
```bash
curl http://192.168.178.57/api/devices
```
1W device shows `"protocol":"1w"` and `"position_estimated":true`.

→ Confirm before Phase 7.

---

### Phase 7 — Web UI wizard + indicators

**Files:** `web_data_v2/index.html`, `web_data_v2/js/devices.js`, `web_data_v2/css/style.css`

**"Add Device" chooser:** existing button opens a modal with two options:
- "2W (bidirectional)" — existing pairing flow, unchanged
- "1W (simplex)" — new wizard

**1W pairing wizard:**
1. Instructions: "Put the device in pairing mode, then click Next" (30 s countdown)
2. Form: name, device type, manufacturer
3. Progress: PAIR → ADD → Done / Failed

**Device card changes:**
- `1W` badge on 1W device cards
- Position bar shown as dashed/faint when `position_estimated` is true
- "Reset position" button on 1W cards (sets software position to 0 or 100 without sending a command)

**Calibration:**
- 2W devices: existing automated "Calibrate" button — unchanged
- 1W devices: manual wizard replaces it:
  1. "Send Open" — sends open command, starts timer
  2. User clicks "Device is open"
  3. "Send Close" — sends close command
  4. User clicks "Device is closed" — elapsed time saved as `transit_time_ms`

**Check:** Full end-to-end in browser. Pair a 1W device → badge appears → manual calibrate → position bar animates → 2W device still works in parallel.

---

## Files summary

| File | Status | Change |
|---|---|---|
| `io-homecontrol/IoHomeControl.hpp` | Modify | `TransmitFrame` → public |
| `io-homecontrol/IoHomeControl.cpp` | **No change** | — |
| `io-homecontrol/protocol/iohome_device.hpp` | Modify | `ProtocolMode` enum + 3 new fields |
| `io-homecontrol/protocol/iohome_crypto.h` | Modify | +`encrypt_1w_key`, +`create_1w_hmac` |
| `io-homecontrol/protocol/iohome_crypto.cpp` | Modify | Implement above two functions |
| `io-homecontrol/Io1WControl.hpp/.cpp` | **New** | 1W controller class |
| `helpers/DeviceStorage.cpp` | Modify | +3 JSON keys, backward-compatible |
| `main/IoRtsManager.hpp/.cpp` | Modify | +`mIo1W`, dispatch methods, Pair/Unpair |
| `components/web_server/web_server.cpp` | Modify | Dispatch, `pair1w`/`unpair1w`, device JSON |
| `helpers/CmdLineIoTools.cpp` | Modify | +`pair1w`, `unpair1w`, `send1w` |
| `web_data_v2/index.html` | Modify | 1W wizard, manual calibration modal |
| `web_data_v2/js/devices.js` | Modify | 1W wizard logic, manual calibration, badge |
| `web_data_v2/css/style.css` | Modify | 1W badge, dashed position bar |
| `io-homecontrol/radio/RadioSX1276.*` | **No change** | — |
| `helpers/DeviceStorage.hpp` | **No change** | — |

---

## Constraints and risks

| Risk | Mitigation |
|---|---|
| 1W pairing requires physical access (prog button) | Wizard has 30 s countdown; user must be near the device |
| Wrong key = device ignores all future commands | UI warning before unpair: "To re-pair the device must be reset" |
| Position estimate diverges after manual interference | "Reset position" button; manual calibration re-run |
| Broadcast means all same-type 1W devices move together | Documented in UI; this is the intended behaviour |
| Sequence counter reset on fresh flash | Initialised to random non-zero at first pairing; persisted after every TX |
| 2W confirmation poll timer fires for 1W device | Blocked in `arm_move` by `protocol_mode` check |
