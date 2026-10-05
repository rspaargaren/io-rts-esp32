# Command Latency Analysis — Original Controller vs. This Firmware

**Date:** 2026-09-11
**Sources:**
- **Capture A** — passive sniff of the original controller (`AA9BFA`) executing a 13-device scene.
- **Capture B** — this firmware (`696969`) driving 3 devices to 48 %, with TX lines logged.

Firmware `b6cf9d6-dirty`.

Symptom: devices react noticeably faster to a scene fired by the original controller than to
a manual command from this project.

**Result: ~1086 ms per device vs. the original's ~159 ms. Two independent causes, both
confirmed, each worth roughly half. Fixing both lands at ~157 ms — parity.**

---

## 0. Reading the logs — two caveats

### 0.1 `(0us preamble)` is not a measurement

`CONFIG_IOHOMECONTROL_SX1276_DIO4=-1` (sdkconfig:1071), and
[`RadioSX1276.cpp:103`](../io-homecontrol/radio/RadioSX1276.cpp#L103) returns `0` whenever
DIO2 *or* DIO4 is unwired:

```cpp
int64_t preambleTime = (mIoDIO2 == GPIO_NUM_NC || mIoDIO4 == GPIO_NUM_NC)
                     ? 0
                     : mLastSyncWordDetectedTime - mLastPreambleDetectedTime;
```

Preamble duration cannot be observed on this board. All preamble conclusions are derived
from inter-frame gaps.

### 0.2 Two clocks, offset by 359.2 ms

`Received at <µs>` is `esp_timer_get_time()`. The log's own `(nnnnnn)` stamp is ms and runs
**359.2 ms ahead**. Verified on both captures independently:

```
Capture A:  34725 −  34365.725 = 359.28 ms
Capture B: 627666 − 627306.824 = 359.18 ms
```

**All timings below are normalised to the log-ms clock** (`received_us / 1000 + 359.2`).
Skipping this makes receives look like they precede their own transmissions.

---

## 1. Reference behaviour — the original controller (Capture A)

`AA9BFA` was the node_id this project cloned. (It has since been changed to `696969` — see
§5.3.)

### 1.1 Per-device transaction

`047CB7` (Büro Martin, type 0x02):

| Frame | Timestamp (µs) | Δ | CTRL0 | CTRL1 | Payload |
|---|---:|---:|---|---|---|
| CMD 00 execute (ctrl→dev) | 34365725 | +0 | `4E` **START** | `00` | `01E788000000` |
| CMD 3C challenge (dev→ctrl) | 34379765 | +14.0 ms | `0E` | `00` | `CB7C9003B9A6` |
| CMD 3D response (ctrl→dev) | 34390799 | +25.1 ms | `0E` | `00` | `46C25AEBB404` |
| CMD 04 status, Moving: Yes | 34406224 | +40.5 ms | `96` | `00` | `0480880087FB0000AA9BFA010000` |

**Command to motor running: ~40 ms.**

Across all 13 devices:

| Metric | Range | Notes |
|---|---|---|
| Full CMD 00 → CMD 04 transaction | 38.6 – 45.5 ms | n = 11 complete |
| CMD 00 → CMD 3C (device turnaround) | 12.7 – 16.3 ms | |
| CMD 3C → CMD 3D (controller challenge response) | 10.5 – 12.3 ms | |
| CMD 00 → next CMD 00 (dispatch cadence) | 133.6 – 190.6 ms | mean ≈ **159 ms** |

### 1.2 Scene structure — two phases

**Phase 1** (34.366 s → 36.311 s, 1.95 s): one CMD 00 per device, back to back, ~159 ms
apart. The controller does **not** wait for movement and does **not** poll during it.

**Phase 2** (36.413 s → 38.064 s): one CMD 03 per device to collect final state. Order
differs from phase 1 — looks like completion order.

This firmware already uses the same two-phase shape (Capture B, §2.1), so the structure is
not the problem.

### 1.3 Channel use

All three channels, roughly round-robin, one per device:

```
047CB7 868.95   03E784 868.25   9FB238 869.85   35D345 868.25
06F483 868.95   9DAF6F 869.85   7FC15D 868.95   BAD662 869.85
8B133C 868.25   EE8165 869.85   6750A8 868.25   B18EEC 868.95
E468A9 869.85
```

Devices are not pinned: `BAD662` is addressed on 869.85 in phase 1, 868.25 in phase 2.

---

## 2. Measured behaviour — this firmware (Capture B)

Three devices to 48 %, `696969` → `03E784`, `E468A9`, `06F483`.

### 2.1 Transactions

Normalised to log-ms:

| Device | Send CMD 00 | Rcv 3C | Δ | Send 3D | Δ | Rcv 04 | Δ | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 03E784 | 627377 | 627666.0 | 289.0 | 627670 | 4.0 | 627959.4 | 289.4 | **582.4** |
| E468A9 | 628463 | 628752.0 | 289.0 | 628756 | 4.0 | 629046.4 | 290.4 | **583.4** |
| 06F483 | 629549 | 629837.0 | 288.0 | 629841 | 4.0 | 630131.4 | 290.4 | **582.4** |

Phase 2 (CMD 03, single leg, no challenge — `030000` is unauthenticated):

| Device | Send CMD 03 | Rcv 04 | Δ |
|---|---:|---:|---:|
| 03E784 | 630634 | 630923.4 | 289.4 |
| 06F483 | 631426 | 631715.4 | 289.4 |
| E468A9 | 632218 | 632507.4 | 289.4 |

**Every single radio leg costs 288 – 290.4 ms.** Extremely consistent.

### 2.2 Cadence

| | This firmware | Original | Ratio |
|---|---:|---:|---:|
| Transaction (CMD 00 → CMD 04) | **582.4 ms** | 40.5 ms | 14.4× |
| Dispatch cadence (send → next send) | **1086 ms** | 159 ms | 6.8× |
| Whole 3-device operation | **5.13 s** | ~0.48 s equivalent | 10.7× |

Cadence is exactly 1086 ms between both CMD 00 pairs and exactly 792 ms between both CMD 03
pairs. That determinism is the clue — it is not radio noise, it is a fixed timeout.

### 2.3 Where the 1086 ms goes

| Component | Cost | Share |
|---|---:|---:|
| Mutex block before send (§4) | 502.6 ms | 46 % |
| Leg 1 — CMD 00 out, CMD 3C back (§3) | 289.0 ms | 27 % |
| Internal turnaround (3C → 3D send) | 4.0 ms | <1 % |
| Leg 2 — CMD 3D out, CMD 04 back (§3) | 290.4 ms | 27 % |
| **Total** | **1086 ms** | |

Of the 579.4 ms of radio legs, **426.6 ms is preamble**.

---

## 2.5 Capture C — startup scan, after the mutex fix

36-device status sweep at boot, firmware carrying the §4.4 fix.

### Verdict: root cause 2 fixed, root cause 1 untouched

| | Capture B (before) | Capture C (after) |
|---|---:|---:|
| Inter-command gap (Rcv → next Send) | 502.6 ms | **3.9 ms** |
| Radio leg (Send → Rcv) | 289.0 ms | **289.1 ms** |

Gap: n = 24, min 3.5, max 4.1, mean **3.9 ms** — the 5 ms yield left in the loop, exactly as
designed. The 500 ms stall is gone.

Leg: n = 29, min 287.9, max 290.1, mean **289.1 ms** — unchanged, because every `Send` still
shows `CTRL1 20`. The preamble fix is in the binary and still inert (§3.6 / §5.1).

### Cost today

Scan window 7286 ms → 19796 ms = **12.51 s** for 36 devices. Of that, ~211.7 ms × 42 legs
≈ **8.9 s is preamble**. With `select_preamble()` live the leg drops to ~77.4 ms and the
sweep to **~3.4 s**.

The sweep is single-legged for most devices (`CMD 03` / `030000` is unauthenticated) and
two-legged for the six type-0x11 blinds, which use `03200100` and draw a `3C`/`3D` challenge
— consistent with the auth asymmetry in §5.5.

### Unrelated: `02FC9E` is unreachable

```
W (7400) SendAndReceive: didn't receive response!
I (7402) Send ... to 02FC9E
W (7776) SendAndReceive: didn't receive response!
W (7781) UpdateDevicesStatusTask: 02FC9E poll failed (consecutive: 1)
```

750 ms burnt on retries (500 ms RX timeout + 250 ms `TIME_BETWEEN_RETRY_MS`), then the
backoff ladder from [`:929`](../io-homecontrol/IoHomeControl.cpp#L929) takes over —
60 s, 5 min, 30 min, 1 hr. Self-limiting, so it costs the boot sweep once and nothing after.
Pre-existing; "Licht Boxen" is either off-mains or out of range.

### Note: three blinds report position unknown

`6750A8`, `7FC15D`, `B18EEC` return `0500D200D8000000…` — position byte `0xD2`
(`CMD_PARAM_POSITION_STOP`), surfaced as the `212.0` placeholder. They reported `100.0` in
Capture A. Tilt still decodes correctly on all three. Pre-existing state, unrelated to any
change here, but worth a look.

---

## 3. Root cause 1 — a 213 ms preamble on every leg

### 3.1 The code path

[`IoHomeControl.cpp:2125`](../io-homecontrol/IoHomeControl.cpp#L2125) and
[`:2143`](../io-homecontrol/IoHomeControl.cpp#L2143), inside `SendAndReceive`:

```cpp
if (TransmitFrame(request, frequency, is_start(request) ? LONG_PREAMBLE_LENGTH
                                                        : SHORT_PREAMBLE_LENGTH))
...
    if (TransmitFrame(challengeResponse, frequency, LONG_PREAMBLE_LENGTH))   // hardcoded
```

Preamble is selected by the **START flag**, not by whether the device needs a wake-up burst.
And `create_execute_request` sets START unconditionally —
[`iohome_commands.cpp:29`](../io-homecontrol/protocol/iohome_commands.cpp#L29):

```cpp
init_frame(frame, true, /*is_start=*/ true, false, is_low_power);
```

So the long branch is always taken. The challenge response then takes a second long preamble
unconditionally. Same pattern at [`:2067`](../io-homecontrol/IoHomeControl.cpp#L2067) in
`SendRaw`.

Capture B confirms it on the wire: CMD 3D goes out as `CTRL0 4E` — START set on a challenge
response.

### 3.2 The arithmetic

From [`iohome_constants.h`](../io-homecontrol/protocol/iohome_constants.h#L25-L29):

```
BIT_RATE              = 38400 bps
LONG_PREAMBLE_LENGTH  = 1024 bytes = 8192 bits
SHORT_PREAMBLE_LENGTH =    8 bytes =   64 bits
```

`SetPreambleLength` writes `REG_PREAMBLEMSB`/`REG_PREAMBLELSB`
([`RadioSX1276.cpp:400`](../io-homecontrol/radio/RadioSX1276.cpp#L400)); the SX1276 FSK
preamble register is in **bytes**, so the values are literal.

| | Airtime |
|---|---:|
| Long preamble | 8192 / 38400 = **213.3 ms** |
| Short preamble | 64 / 38400 = **1.7 ms** |
| Per authenticated command (both legs) | **426.6 ms** |
| Original controller's equivalent | ~3.4 ms |

### 3.3 Reconciling with the measured 289 ms per leg

| Component | Estimate |
|---|---:|
| Long preamble | 213.3 ms |
| Frame + sync airtime (20 bytes) | 4.2 ms |
| Device turnaround (from Capture A) | 13 – 16 ms |
| TX→RX switch, SPI, PLL lock, ISR→queue→task | ~56 ms |
| **Total** | **~289 ms** ✓ |

Preamble is **74 %** of each leg. The ~56 ms remainder is real but second-order.

### 3.4 Proof the original does not do this

**(a) Tightest gap before a START-flagged frame — 60.3 ms.**

```
36977276  8B133C  CMD 04  (end of previous transaction)
37037620  EE8165  CMD 03  CTRL0 4C  → 0x4C & 0x40 = START set
Δ = 60344 µs
```

213 ms cannot fit in 60 ms. Full set of phase-2 gaps: 101.5, 117.2, 106.4, 120.4, 85.6,
**60.3**, 71.1, 120.5, 167.5, 123.3, 116.3, 235.8 ms.

**(b) CMD 3C → CMD 3D turnaround — 10.5 to 12.3 ms.** This is precisely the frame this
firmware hardcodes to a 213 ms preamble. Capture B measures the same leg at 289.4 ms — a
**26× difference on an identical frame type**.

The original sets START on its command frames (CTRL0 `4E`, `50`, `4B`, `4C` all have bit 6)
but does not couple preamble length to it.

### 3.5 Interpretation

The long preamble is a **wake-up burst** for duty-cycled receivers — solar and battery
devices that sample the band periodically. The comment at
[`iohome_constants.h:28`](../io-homecontrol/protocol/iohome_constants.h#L28) says as much,
and that 4096 bits was insufficient for solar blinds. Mains-powered devices listen
continuously and need only sync acquisition.

Coupling it to START applies the wake-up cost to every device unconditionally.

### 3.6 Fix — implemented, but inert until §5.1

Preamble now keys off the **destination's power class** rather than the START flag. A new
`is_low_power(frame)` helper reads `CTRL1_LOW_POWER`
([`iohome_frame.hpp:134`](../io-homecontrol/protocol/iohome_frame.hpp#L134)) — the bit
`create_execute_request` already sets from the device DB — and a file-scope
`select_preamble()` ([`IoHomeControl.cpp:48`](../io-homecontrol/IoHomeControl.cpp#L48))
wraps the choice.

Applied at all three sites: both `SendAndReceive` legs
([`:2147`](../io-homecontrol/IoHomeControl.cpp#L2147),
[`:2165`](../io-homecontrol/IoHomeControl.cpp#L2165)) and `SendRaw`
([`:2086`](../io-homecontrol/IoHomeControl.cpp#L2086)). The decision is taken once from the
request and reused for the challenge response, since both legs address the same device.

Pairing and discovery still call `TransmitFrame` directly with an explicit
`LONG_PREAMBLE_LENGTH` and are untouched — a device being paired is not in the DB yet, so
its power class is unknown and the wake-up burst is the safe default.

**Expected saving: ~423 ms per command — but zero today.** Every device in the DB is flagged
low-power, so `select_preamble()` still returns LONG for all of them. No regression, no gain
until §5.1 is resolved.

## 4. Root cause 2 — a 500 ms mutex hold between commands

Not predicted before Capture B. Worth slightly *more* than the preamble.

### 4.1 The measurement

Dead time between the end of one transaction and the start of the next send:

| From (Rcv CMD 04) | To (next Send) | Δ |
|---|---|---:|
| 627959.4 | 628463 | 503.6 ms |
| 629046.4 | 629549 | 502.6 ms |
| 630131.4 | 630634 | 502.6 ms |
| 630923.4 | 631426 | 502.6 ms |
| 631715.4 | 632218 | 502.6 ms |

And from the firmware's own decision point — `"Setting position to 48%"` is logged *before*
`xSemaphoreTake`:

```
627962 "Setting position to 48%"  →  628463 Send   = 501 ms
629049 "Setting position to 48%"  →  629549 Send   = 500 ms
```

(The first command of the burst waited only 240 ms — the radio stack was idle beforehand.)

Constant to within 2 ms across five independent samples. That is a timeout, not contention.

### 4.2 The code path

[`IoHomeControl.cpp:663-666`](../io-homecontrol/IoHomeControl.cpp#L663) in
`ProcessReceivedFrameTask`:

```cpp
for (;;)
{
  if (xSemaphoreTake(sMutex, MUTEX_MAX_WAIT_TICKS))          // :663  takes the mutex
  {
    RxFrameQueueItem item;
    if (xQueueReceive(sRxIoQueue, &item, RECEIVED_IO_TREATMENT_WAIT_TICKS))   // :666  blocks 500 ms
    {
      ...
    }
    xSemaphoreGive(sMutex);                                   // :819  releases
    vTaskDelay(pdMS_TO_TICKS(5));                             // :820
```

`RECEIVED_IO_TREATMENT_WAIT_TICKS = 500 ms`
([`:34`](../io-homecontrol/IoHomeControl.cpp#L34)).

**The task blocks for up to 500 ms waiting on a queue while holding the global radio
mutex.** It is idle-waiting, not working — but nothing else can touch the radio.

### 4.3 Why it fires on every command

`sRxIoQueue` has two consumers:

- `ReceiveMatchingFrame`, called from `SendAndReceive` inside `SetDevicePosition`, which
  holds `sMutex` for the whole transaction;
- `ProcessReceivedFrameTask`, which takes `sMutex` first.

Sequence per command:

1. `SetDevicePosition` #1 completes and releases `sMutex`.
2. `ProcessReceivedFrameTask` immediately grabs it and sits in `xQueueReceive` — but
   `SendAndReceive` already consumed the CMD 04, so **nothing will arrive**.
3. `SetDevicePosition` #2 blocks on `xSemaphoreTake` for the full **500 ms**.
4. The queue receive times out, the mutex is released, 5 ms yield.
5. `SetDevicePosition` #2 finally transmits.

Deterministic, which is exactly what the data shows. It applies to every command after the
first, including the phase-2 CMD 03 polls.

### 4.4 Fix — implemented

The obvious fix is to take the mutex *after* the queue receive. **That is wrong**, and worth
recording why: the mutex is also what stops this task stealing frames. Every other consumer
of `sRxIoQueue` (`ReceiveMatchingFrame` at [`:232`](../io-homecontrol/IoHomeControl.cpp#L232),
the pairing paths, 14 sites in total) runs while holding `sMutex`. Releasing it around the
receive would let `ProcessReceivedFrameTask` consume the CMD 3C or CMD 04 that
`SendAndReceive` is blocked on — turning a 500 ms delay into a retry storm (3 tries ×
750 ms ≈ 2.25 s) or an outright command failure.

The mutex must stay held across the receive. It just must not be held *while idle*. So the
receive becomes non-blocking and the task polls on its existing 5 ms yield
([`:685`](../io-homecontrol/IoHomeControl.cpp#L685)):

```cpp
if (xSemaphoreTake(sMutex, MUTEX_MAX_WAIT_TICKS))
{
    RxFrameQueueItem item;
    if (xQueueReceive(sRxIoQueue, &item, 0))     // was RECEIVED_IO_TREATMENT_WAIT_TICKS
    {
        ...
    }
    xSemaphoreGive(sMutex);
}
else { IO_LOGE(...); }
vTaskDelay(pdMS_TO_TICKS(5));                    // moved out, so a failed take also yields
```

Worst-case added latency drops from 500 ms to 5 ms. Frame throughput is unchanged — the old
code also processed at most one frame per 5 ms yield. Arbitration is untouched.

The underlying design smell remains: `SendAndReceive` and `ProcessReceivedFrameTask` pulling
from one queue, arbitrated only by a mutex, is fragile. A proper fix routes solicited
responses to the requesting task instead. Out of scope here.

**Expected saving: ~500 ms per command.**

---

## 5. Secondary findings

### 5.1 `is_low_power` set on every device — confirmed on the wire

**Predicted, then confirmed.** Every TX line in Capture B carries **`CTRL1 20`**
(`CTRL1_LOW_POWER`); every device replies `CTRL1 00`. In Capture A the original sends
`CTRL1 00` throughout — it flags none of these devices as low-power.

`devices_extracted/io-rts-backup.json` has `"is_low_power": true` on **all 36 devices**;
`devices_extracted/devices.json` has it `false` for all but `E468A9`. The flag was set
wholesale somewhere. `create_execute_request` passes it straight into CTRL1 bit 5
([`iohome_frame.cpp:37`](../io-homecontrol/protocol/iohome_frame.cpp#L37)).

This does not itself cost time — but it is the input §3.6 depends on, and it is on-air
divergence from the reference.

The same two files also disagree on `transit_ms` (30000 vs 0) and `info2` (empty vs real
serials); the backup may not be a trustworthy source for repairing the flag.

### 5.2 All commands pinned to channel 2 — confirmed

Every Capture B frame is on 868.95. `SetDevicePosition`
([`IoHomeControl.cpp:1618`](../io-homecontrol/IoHomeControl.cpp#L1618)) hardcodes
`FREQUENCY_CHANNEL_2`; the original round-robins all three (§1.3).

No retries occurred in Capture B, so this cost nothing *here*. It remains a robustness risk:
each failed attempt costs `RECEIVED_IO_TREATMENT_WAIT_TICKS` (500 ms) +
`TIME_BETWEEN_RETRY_MS` (250 ms), ×3 tries ≈ **2.25 s** before a command is reported failed.

### 5.3 Node ID changed to `696969`

Capture B transmits from `696969`, not the `AA9BFA` recorded in the backup. Note that
`E468A9`'s CMD 04 payload still carries `AA9BFA` where `03E784` and `06F483` carry `696969`:

```
03E784  0480600064620001 696969 010000
E468A9  0480600065AA0001 AA9BFA 010000     ← stale association
06F483  0480600062440001 696969 010000
```

`E468A9` is also the one device `devices.json` flags low-power/Somfy. Probably stale state
from the original controller rather than a fault — but worth a look if that device
misbehaves.

### 5.4 Payload divergence — confirmed (does not affect speed)

**ACEI byte.** Original sends `data[1] = 0xE7`; this firmware sends `0x67`
([`iohome_commands.cpp:39`](../io-homecontrol/protocol/iohome_commands.cpp#L39)). Bit 7
differs. Purpose unknown; devices accept both.

**Frame length.** For plain roller shutters (type 0x02) the original sends a **6-byte** form;
this firmware always sends 8 bytes. Capture B at 48 % (`0x60` = 96 = 2×48):

```
original  6B:  01 E7 <2·pos> 00 00 00                 CTRL0 4E
original  8B:  01 E7 <2·pos> 00 80 D8 <05|06> 00      CTRL0 50
ours      8B:  01 67 60      00 80 D8 06       00     CTRL0 50
```

All three Capture B devices are type 0x02, and `03E784`/`06F483` received the 6-byte form
from the original in Capture A. But the split is not clean by type (`9DAF6F` is 0x02 and got
8 bytes), so this needs more data before changing anything.

### 5.5 Tilt: parameter selector `0x20` — confirmed decode

For type 0x11 (external venetian blind) devices the original replaces bytes 4–5 with a
**parameter selector and setpoint**:

```
01 E7 C8 00 20 <tilt> 00 00        CTRL0 50
              ^^ ^^^^
              |  setpoint, same 2×percent scale as position (0x00–0xC8)
              parameter selector = 0x20 (tilt / orientation)
```

and polls it back with `CMD 03` payload `03 20 01 00` (CTRL0 `4C`) instead of `03 00 00`
(CTRL0 `4B`). The response is 16 bytes instead of 14, with `20 <u16> 00` appended.

Decode verified — raw / 51200, then inverted:

| Device | Commanded | Response tail | Raw | /51200 | 100 − x | Logged |
|---|---|---|---:|---:|---:|---:|
| BAD662 | `20 76` | `20 77 8A 00` | 0x778A = 30602 | 59.77 | 40.23 | **40.2** |
| 8B133C | `20 6E` | `20 70 A5 00` | 0x70A5 = 28837 | 56.32 | 43.68 | **43.7** |
| EE8165 | `20 68` | `20 67 73 00` | 0x6773 = 26483 | 51.72 | 48.28 | **48.3** |
| 6750A8 | `20 72` | `20 75 3E 00` | 0x753E = 30014 | 58.62 | 41.38 | **41.4** |
| 7FC15D | `20 70` | `20 72 F1 00` | 0x72F1 = 29425 | 57.47 | 42.53 | **42.5** |

Exact on all five. Full scale 51200 = `CMD_PARAM_STATUS_POS_MAX` (0xC800).

This firmware hardcodes `data[4] = 0x80, data[5] = 0xD8` and never requests parameter 0x20 —
which is why tilt reads as the `212.0` placeholder (visible on all three Capture B devices).

**Auth asymmetry:** `CMD 03` with `030000` gets a direct CMD 04, no challenge — confirmed in
both captures. `CMD 03` with `03200100` triggers the full `3C`/`3D` exchange. Requesting the
tilt parameter requires authentication; plain status does not. So
`CMD_PRIVATE = 0x03 // No authentication needed` is only partly true.

### 5.6 Latent bug — preamble/sync watchdog is 1000× too long

[`IoHomeControl.cpp:403`](../io-homecontrol/IoHomeControl.cpp#L403):

```cpp
else if ((esp_timer_get_time() - preambleSyncDetectedStartUs) > CHANNEL_PREAMBLE_SYNC_TIMEOUT_US * 1000)
```

`esp_timer_get_time()` returns **µs**, and `CHANNEL_PREAMBLE_SYNC_TIMEOUT_US` is **already
µs** (200000 = 200 ms). The `* 1000` makes the threshold 200,000,000 µs = **200 seconds**, so
the "resetting radio" recovery path effectively never fires.

This matters because a stuck preamble/sync flag also **blocks transmission**: the TX dequeue
at [`:412`](../io-homecontrol/IoHomeControl.cpp#L412) sits behind
`!isSyncWordDetected() && !isPreambleDetected()`.

Not implicated in Capture B — no timeout warnings, and the 502.6 ms gap is fully explained by
§4. But Capture A contains `E (34912) RadioSX1276: isSyncWordDetected - Busy`, so the flag
does get into odd states. Drop the `* 1000`.

*(The neighbouring `X_US * portTICK_PERIOD_MS / 1000` conversions are fine — `CONFIG_FREERTOS_HZ=1000`,
so `portTICK_PERIOD_MS` is 1 and they reduce to µs→ms→ticks correctly. They would be wrong at
any other tick rate.)*

---

## 6. Latency budget — measured

Per device, authenticated position command:

| Contributor | This firmware | Original | Fixable by |
|---|---:|---:|---|
| Mutex block before send | 502.6 ms | — | §4.4 |
| Request preamble | 213.3 ms | ~1.7 ms | §3.6 |
| Challenge-response preamble | 213.3 ms | ~1.7 ms | §3.6 |
| Frame airtime, 4 frames | ~8.4 ms | ~8.4 ms | — |
| Device turnaround ×2 | ~28 ms | ~25 ms | — |
| Radio mode switch / SPI / task latency ×2 | ~112 ms | — | partly |
| Internal 3C→3D turnaround | 4.0 ms | ~11 ms | — |
| **Measured cadence** | **1086 ms** | **159 ms** | |

Removing both root causes: 1086 − 502.6 − 423 ≈ **157 ms**, against the original's 159 ms.

**Status:**

| | Change | State |
|---|---|---|
| 1 | §4.4 — mutex hold (~500 ms) | ✅ **verified on hardware** — 502.6 → 3.9 ms (§2.5) |
| 2 | §5.6 — watchdog unit bug | ✅ implemented, builds |
| 3 | §3.6 — preamble selection (~423 ms) | ✅ implemented, **inert** pending #4 |
| 4 | §5.1 — repair `is_low_power` in the device DB | ❌ open — needs a decision, see §7 |
| 5 | §5.2 — channel round-robin | ❌ open — robustness, not latency |

Capture C (§2.5) confirms #1 on hardware. #3 is in the binary but inert: legs are still
289 ms and every `Send` still carries `CTRL1 20`. Expect ~586 ms per command until #4 lands,
~157 ms after.

## 7. Still open

- **Which devices are genuinely low-power?** Capture A shows `CTRL1 00` for all 13, including
  `E468A9`, which `devices.json` flags low-power. If *none* of the fleet is truly
  solar/battery, §3.6 simplifies to a short preamble everywhere. Needs a device inventory,
  not a log.
- **The ~56 ms per-leg overhead** beyond preamble, airtime and device turnaround (§3.3).
  Worth revisiting once the preamble no longer dominates — it would be ~36 % of what remains.
- **6-byte vs 8-byte execute form** (§5.4) — no clean rule yet.
- **Does removing the long preamble break any device?** The comment at
  `iohome_constants.h:28` records real experimentation. Re-test per device after §3.6,
  especially `E468A9`.

---

## 8. Capture D — the original controller's full status sweep

**New capture, 2026-09-11.** Passive sniff of `AA9BFA` polling every device it knows.
147 frames, 13 devices, **5881 ms** end to end. This is the scenario
`UpdateDevicesStatusTask` implements, so it is the direct reference for Capture C.

All timings are `Received at` (µs, esp_timer) deltas — one clock, no normalisation needed.

### 8.1 The reference numbers

**Device turnaround** — controller frame on air → device's reply on air:

| Exchange | n | min | mean | max |
|---|---:|---:|---:|---:|
| `19` → `FE` | 28 | 10.5 | **11.2** | 12.0 |
| `46` → `47` | 12 | 12.5 | **13.0** | 13.9 |
| `4A` → `3C` | 10 | 13.6 | **14.3** | 14.6 |
| `3D` → `4B` | 12 | 11.8 | **15.2** | 18.7 |
| `03` → `04` | 8 | 15.2 | **16.5** | 17.9 |
| **all** | **70** | **10.5** | **13.3** | **18.7** |

**Controller turnaround** — device reply → controller's next frame. Cleanly bimodal, and the
split is *channel change*, not command type:

| | n | min | mean | max |
|---|---:|---:|---:|---:|
| next frame on the **same** channel (`3C`→`3D` only) | 11 | 10.5 | **11.3** | 12.2 |
| next frame on a **different** channel | 58 | 24.7 | **73.7** | 113.0 |

Frame-to-frame cadence overall: mean **78.2 ms**, median 82.0.

So the original's floor is ~11 ms in both directions. Its ~74 ms is self-imposed —
the price it pays for rotating channels, not a protocol requirement.

### 8.2 Channel use — rotation is per *transaction*

868.25 × 23, 868.95 × 27, 869.85 × 26 across 76 controller transmissions. Only 11 of 75
consecutive TX pairs share a channel, and those 11 are exactly the intra-transaction frames:
an authenticated exchange (`4A`→`3C`→`3D`→`4B`) stays on one channel start to finish, and
the *next* exchange moves on. Refines §5.2 — the unit of rotation is the transaction, not
the frame.

### 8.3 Retries — ~106 ms apart, one per channel

Six controller transmissions drew no reply. Clearest case, `35D345` / `CMD 19` payload `07`:

```
21169614  868.95  19 → 35D345  07     (no reply)
21275735  868.25  19 → 35D345  07     +106.1 ms, no reply
21381676  869.85  19 → 35D345  07     +105.9 ms
21392218  869.85  FE ← 35D345  05     +10.5 ms — succeeded on the third channel
```

Retry interval **~106 ms**, and each attempt moves to the next channel. Against this
firmware's 500 ms timeout + 250 ms fixed delay on a hardcoded `FREQUENCY_CHANNEL_2`.

### 8.4 Don't copy the `CMD 19` probing

61 of 147 frames — **41 %** of the sweep — are `CMD 19` / `FE` pairs. The controller probes
parameters `02`, `03`, `04`, `07` on each of the seven type-0x02 shutters and gets error
`FE`/`05` back every single time. ~2.5 s of the 5.9 s sweep, for nothing. It skips this
entirely on the six 0x0F lights. This is the original's overhead, not a pattern to adopt.

### 8.5 Poll payload by device class

| Device class | Request | CTRL0 | Reply | Legs |
|---|---|---|---|---:|
| 0x02 roller shutter | `CMD 03` `030000` | `4B` | 14-byte `CMD 04` | 1 |
| 0x0F/0x02 light, socket | `CMD 03` `03000801` | `4C` | 16-byte `CMD 04` | 1 |
| 0x11 ext. venetian (Capture A) | `CMD 03` `03200100` | `4C` | 16-byte `CMD 04` | 2 (3C/3D) |

Only the tilt form costs two legs. `deviceTypeSupportsTilt()`
([`iohome_device.cpp:5`](../io-homecontrol/protocol/iohome_device.cpp#L5)) correctly excludes
0x0F, so this firmware already pays one leg there — but it sends `030000` where the original
sends `03000801`, and gets the shorter 14-byte reply. Data completeness, not latency.

The `46`/`47` + `4A`/`3C`/`3D`/`4B` block the original runs after polling each 0x0F device is
a configuration/schedule read (`080200A6 03…` then `…07…`), not status. Unneeded here.

### 8.6 Capture D vs this firmware

| | Original (D) | This firmware (C) | Ratio |
|---|---:|---:|---:|
| Device turnaround (air to air) | 13.3 ms | — | |
| Round trip, TX → reply | ~13 ms | **289.1 ms** | 22× |
| Inter-command gap | 73.7 ms (self-imposed) | 3.9 ms | |
| Frame-to-frame cadence | **78.2 ms** | ~293 ms | 3.7× |
| Retry interval | ~106 ms, hops channel | 750 ms, same channel | 7× |
| Sweep | 13 devices / 5.88 s | 36 devices / 12.51 s | |

Per-leg overhead beyond the original's 13 ms is **276 ms**: 213 ms preamble (§3) and ~63 ms
of stack.

---

## 9. Improvements, ranked

### 9.1 `create_getstatus03_*` hardcodes `is_low_power = true` — the poll path never consults the DB

**This is why §3.6 will stay inert on the status sweep even after the device DB is repaired.**

[`iohome_commands.cpp:94`](../io-homecontrol/protocol/iohome_commands.cpp#L94),
[`:109`](../io-homecontrol/protocol/iohome_commands.cpp#L109),
[`:481`](../io-homecontrol/protocol/iohome_commands.cpp#L481):

```cpp
bool create_getstatus03_request(IoFrame &frame, const uint8_t *own, const uint8_t *dst)
{
    init_frame(frame, true, true, false, /*is_lowPower=*/ true);   // ← literal, not a parameter
```

Every other builder takes `bool is_low_power` and passes it through
(`create_execute_request`, `create_getname_request`, `create_getinfo{1,2,3}_request`,
`create_identify_request`, `create_set_config1_command`). These three — the polling path — do
not. So `select_preamble()` sees `CTRL1_LOW_POWER` and returns LONG on every status poll
regardless of what the device DB says.

**Fix:** give them the same `bool is_low_power` parameter and pass
`dev->second.info.is_low_power` from
[`IoHomeControl.cpp:930`](../io-homecontrol/IoHomeControl.cpp#L930).

**Saving: 211.6 ms per leg on every poll.**

### 9.2 §7's open question is settled — no device is low-power

All **76** controller→device frames in Capture D carry `CTRL1 00`, across all 13 devices
**including `E468A9`**, the one `devices.json` flags low-power. Combined with Capture A's 13
devices that covers the fleet the original talks to.

Set `is_low_power = false` for every device in the DB. Keep the flag and
`select_preamble()` — a genuinely solar blind added later still needs the wake-up burst — but
the current wholesale `true` is wrong.

### 9.3 Drop the START flag on the challenge response

The original sends `CMD 3D` as **`CTRL0 0E`** — no START — in every one of the 12 challenge
exchanges in Capture D. [`IoHomeControl.cpp:2163`](../io-homecontrol/IoHomeControl.cpp#L2163):

```cpp
bool setStartFlagToAuthentResponse = true;     // initialised true, only ever re-set to true
...
if (setStartFlagToAuthentResponse)
  challengeResponse.ctrl_byte_0 |= CTRL0_START;
```

Capture B confirmed it on the wire (`CTRL0 4E`). Two costs:

1. Under the pre-§3.6 rule it forced the long preamble on leg 2.
2. [`IoHomeControl.cpp:449`](../io-homecontrol/IoHomeControl.cpp#L449) — `is_start()` makes
   `process_radio_task` set `waitTime = CHANNEL_RESPONSE_START_TIME_US` (**300 ms**) instead
   of `CHANNEL_RESPONSE_TIME_US` (50 ms), pinning the radio on that channel for 300 ms after
   every challenge response.

The variable name says the flag was meant as a retry fallback. It is never cleared, so it is
unconditional. Default it to `false`.

### 9.4 Response timeout — 500 ms against a measured worst case of 18.7 ms

`SendAndReceive` uses `RECEIVED_IO_TREATMENT_WAIT_TICKS` (500 ms) for both
`ReceiveMatchingFrame` calls ([`:2150`](../io-homecontrol/IoHomeControl.cpp#L2150),
[`:2168`](../io-homecontrol/IoHomeControl.cpp#L2168)). Slowest device turnaround across
Captures A and D: **18.7 ms**. The original gives up at ~106 ms.

3 tries × (500 ms timeout + 250 ms `TIME_BETWEEN_RETRY_MS`) = **2.25 s** to fail a command,
against the original's ~320 ms for three attempts.

Give `SendAndReceive` its own constant — `RESPONSE_WAIT_MS = 100`, `TIME_BETWEEN_RETRY_MS`
→ ~30 ms — and leave the 500 ms where it is for the pairing and discovery paths, which have
different device behaviour. Guard: if the request went out with `CTRL1_LOW_POWER` set, keep
the long timeout — a genuinely duty-cycled device may well be slower.

### 9.5 Retry on the next channel

Capture D §8.3: the original's retries walk the channels, and that is what recovers the
exchange. `SendAndReceive` retries all three attempts on the `frequency` argument it was
given, and every caller passes `FREQUENCY_CHANNEL_2`. Rotating per attempt costs nothing.

### 9.6 Rotate the channel per transaction

§8.2. Pick a channel when the transaction starts, keep it for both legs, advance on the next
transaction. Closes §5.2 with the missing detail — rotation is per transaction, not per
frame, which is why the original's `4A`/`3C`/`3D`/`4B` blocks are single-channel.

Secondary benefit: 42 legs × 213 ms of preamble is ~8.9 s of transmit inside a 12.5 s sweep,
all of it on 868.95 — which sits in the 868.7–869.2 MHz sub-band. Even averaged over an hour
that is worth not repeating often. §9.1 removes most of it; rotation spreads the rest.

### 9.7 The ~63 ms/leg of stack overhead

Once §9.1 lands this is the dominant term (77 ms leg vs the original's 13 ms). Suspects, in
the order worth checking:

**(a) TX is gated behind two SPI reads and can be deferred in 9.5 ms quanta.**
[`IoHomeControl.cpp:427`](../io-homecontrol/IoHomeControl.cpp#L427) only dequeues `sTxIoQueue`
when `!isSyncWordDetected() && !isPreambleDetected()`. If either is set — a noise trip on the
preamble detector is enough — the task takes the preamble branch, sets
`waitTime = CHANNEL_PREAMBLE_TIME_US` (9.5 ms) and re-checks. Each check is a mutexed SPI
read. A queued frame can sit through several of these before reaching the FIFO.

**(b) The radio hops away 2.7 ms after every RX.** On a successful receive the task sets
`waitTime = CHANNEL_HOP_TIME_US` ([`:404`](../io-homecontrol/IoHomeControl.cpp#L404)) and then
changes frequency. Between receiving `CMD 3C` and transmitting `CMD 3D` the receiver has
usually already left the channel the exchange is on. `Send()` puts it back, but anything that
arrives late is missed.

**(c) `Send()` takes the radio mutex five separate times** —
`Standby()`, `SetPreambleLength()`, `SetFrequency()`, FIFO write, OPMODE write
([`RadioSX1276.cpp:469`](../io-homecontrol/radio/RadioSX1276.cpp#L469)). `gpio_task` runs at
priority 10, above `process_radio_task`'s 8, and contends for the same mutex. Batching under
one take removes four preemption windows from the critical path.

**(d) Return to RX after TX is two task switches deep.** PacketSent → DIO0 ISR →
`sGpioEvtQueue` → `gpio_task` → `StartReceive()` → `Standby()` + OPMODE write
([`RadioSX1276.cpp:115`](../io-homecontrol/radio/RadioSX1276.cpp#L115)). The device replies
~11 ms later. Probably fine, but if it is ever not, the reply is lost and costs a full retry.

**Don't guess — instrument.** Five `esp_timer_get_time()` marks on one leg: `TransmitFrame()`
entry, `Send()` entry, PacketSent ISR, `StartReceive()` return, PayloadReady. One capture
settles which of (a)–(d) owns the 63 ms.

### 9.8 Projected

| Stage | Leg | Cadence | 36-device sweep |
|---|---:|---:|---:|
| Today (Capture C) | 289 ms | ~293 ms | **12.5 s** |
| + §9.1 / §9.2 (preamble actually short) | ~77 ms | ~81 ms | **~3.4 s** |
| + §9.7 (stack overhead) | ~20 ms | ~25 ms | **~1.1 s** |
| *Original controller, for reference* | *~13 ms* | *78 ms* | *~5.9 s / 13 dev* |

§9.1 alone reaches the original's cadence. §9.7 beats it, because the original's 74 ms
inter-transaction pause is a choice it makes and this firmware need not copy.

---

## 10. Implementation — adaptive preamble (experiment)

**Hypothesis under test:** the wake-up burst is needed to reach a *cold* device, but once a
device has answered it keeps its receiver on for a while, so a burst of follow-up requests can
use the short preamble. Switching to short unconditionally would then break the first request
of each burst.

Both captures argue the burst is never needed for this fleet (13 devices, `CTRL1 00`
throughout, ~11 ms turnaround). But that cannot be *proved* from a passive sniff of someone
else's controller, so the implementation is built to find out empirically and to recover
whichever way the answer goes.

### 10.1 What was changed

| | |
|---|---|
| `iohome_commands.{hpp,cpp}` | `create_getstatus03_request`, `create_getstatus03_tilt_request`, `create_getbattery_request` take `bool is_low_power` instead of hardcoding `true` (§9.1) |
| `IoHomeControl.hpp` | `PreamblePolicy` enum, `SetPreamblePolicy()` / `GetPreamblePolicy()` / `ResetPreambleLearning()` |
| `IoHomeControl.cpp` | per-destination `PreambleState`, `select_request_preamble()`, response timeout scaled by preamble airtime, START flag off the challenge response |
| `CmdLineIoTools.cpp` | `io_preamble` console command |

### 10.2 The three policies

`io_preamble <adaptive|wakefirst|legacy|reset>` — switching policy also resets learning, so
one run does not colour the next.

**`adaptive`** (default) — a cold request probes with SHORT. If it goes unanswered the retry
escalates to LONG, and after `PREAMBLE_SHORT_FAILURES_TO_DEMOTE` (2) failed probes the device
is remembered as `NEEDS_LONG`. A demoted device is re-probed once an hour
(`PREAMBLE_REPROBE_US`) so a bad learn heals itself. Costs at most one wasted attempt per
device per session if the hypothesis turns out to be right.

**`wakefirst`** — the hypothesis, implemented literally. A cold request always uses LONG; SHORT
is used only inside the awake window. Slower than `adaptive` on a sweep (every device is cold
once per sweep) but faster than today on bursts and on leg 2. Use this if `adaptive` proves
unreliable on some device.

**`legacy`** — pre-existing behaviour, `CTRL1_LOW_POWER` alone decides. For A/B baselines.

### 10.3 Rules that apply under every policy

- **Awake window** — a device that completed an exchange within `PREAMBLE_AWAKE_WINDOW_US`
  (5 s) gets SHORT. It demonstrably has its receiver on; this is the part of the hypothesis
  that is safe regardless of how the cold case turns out.
- **Leg 2 is always SHORT.** The challenge response follows the device's own challenge by
  ~11 ms. There is no reading of the protocol under which that device is asleep. This alone
  removes 213 ms from every authenticated command.
- **Retries always escalate to LONG.** A missed reply is never re-attempted with the same
  preamble that may have caused it.

### 10.4 Supporting changes

- **Response timeout now scales with what was transmitted:**
  `RESPONSE_WAIT_SLACK_MS` (200) + the preamble's own airtime. It has to, because the timer
  starts when the frame is *queued*, not when it leaves the antenna — a flat 200 ms would
  expire before a 213 ms long preamble had even finished sending. Short leg → 202 ms window,
  long leg → 413 ms, against 500 ms flat before.
  The slack is deliberately generous (§9.7's ~76 ms of stack overhead is still there, so
  ~2.6× margin). **An early timeout would be misread as a failed probe and demote a good
  device**, so this wants tightening only after §9.7.
- `TIME_BETWEEN_RETRY_MS` 250 → 40 ms.
- `RECEIVED_IO_TREATMENT_WAIT_TICKS` (500 ms) is untouched and still used by the pairing and
  discovery paths, where device behaviour is different and the long wait is load-bearing.
- The `Send` log line now carries `[preamble N B / M ms]`, so a capture shows directly which
  preamble each frame used.

### 10.5 How to read the result

```
io_preamble legacy      # baseline, then trigger a sweep and capture
io_preamble adaptive    # same again
io_preamble wakefirst   # same again
io_preamble             # show current policy
```

Per leg, `Send ... [preamble 8 B / 1 ms]` → `Received at` should land at **~77 ms** instead of
289 ms. Watch for:

- `didn't receive response! (attempt 1/3, preamble 8 B)` — a failed cold probe. One or two per
  device on the first sweep is the learner working. **Persistently** on the same device means
  that device genuinely needs the burst, and `adaptive` will settle it to LONG by itself.
- Every frame still showing `preamble 1024 B` under `adaptive` — the learner demoted
  everything, i.e. the short preamble does not reach this fleet at all. That would refute the
  capture evidence and is the result worth knowing.

### 10.6 Not yet done

§9.5 (retry on the next channel) and §9.6 (per-transaction channel rotation) are still open —
every exchange remains pinned to `FREQUENCY_CHANNEL_2`. Worth doing next, because under
`adaptive` a channel-specific collision currently looks exactly like a failed short probe and
will demote a device that had nothing wrong with it.

---

## 11. First hardware result — 8-byte preamble refuted, ladder introduced

### 11.1 What the capture showed

Controlling `E468A9` failed outright:

```
98350  Send CMD 00 → E468A9  [preamble    8 B / 1 ms]
98546  didn't receive response! (attempt 1/3, preamble 8 B)
98588  Send CMD 00 → E468A9  [preamble 1024 B / 213 ms]     ← escalated
98877  Rcvd CMD 3C ← E468A9  RSSI -81.0                     ← device answered
98889  Send CMD 3D → E468A9  [preamble    8 B / 1 ms]       ← 3 ms after its challenge
99078  didn't receive final response! (attempt 2/3)
99120  Send CMD 00 → E468A9  [preamble 1024 B / 213 ms]
99408  Rcvd CMD 3C ← E468A9  RSSI -41.5
99420  Send CMD 3D → E468A9  [preamble    8 B / 1 ms]
99609  didn't receive final response! (attempt 3/3)
99613  SetDevicePosition: failed to send request!
```

Two things in §10 were wrong.

**(a) "Leg 2 is always safe with the short preamble" — refuted.** §10.3 argued there is "no
reading of the protocol under which that device is asleep" 3 ms after sending its own
challenge. That reasoning was sound and the conclusion was still wrong, which locates the
error: the preamble is not only a wake-up burst, it is also the time the receiver needs to
settle AGC/AFC and match its preamble detector. That requirement is a function of **link
margin**, not of whether the device is awake. `E468A9` swung between RSSI -81 and -41.5 inside
a single exchange.

Reported behaviour matches: failures are **intermittent, not deterministic**, and the
tilt-capable blinds — the closer, stronger-signal devices — are noticeably more reliable. A
sleep/wake rule would be all-or-nothing per device; a margin rule is exactly this.

**(b) The retry ladder did not escalate leg 2.** Leg 2 was hardcoded to SHORT on every
attempt, so attempts 2 and 3 re-sent the same 8-byte frame that had just been missed. All
three attempts were spent on a leg that could never succeed.

### 11.2 What 8 bytes should have been

`SHORT_PREAMBLE_LENGTH` (8 B / 1.7 ms) was never a measured value. Back-solving the reference
controller's inter-frame gaps in Capture D gives the real figure. For each same-channel pair,
`gap = turnaround + preamble airtime + frame airtime`:

| Exchange | gap | frame airtime | implied preamble @ 3 ms turnaround | @ 5 ms |
|---|---:|---:|---:|---:|
| `3C`→`3D` (controller) | 11.3 ms | 3.8 ms | 22 B | 12 B |
| `19`→`FE` (device) | 11.2 ms | 2.7 ms | 27 B | 17 B |
| `03`→`04` (device) | 16.5 ms | 5.4 ms | 39 B | 29 B |
| `46`→`47` (device) | 13.0 ms | 3.3 ms | 32 B | 23 B |
| `4A`→`3C` (device) | 14.3 ms | 3.8 ms | 36 B | 26 B |
| `3D`→`4B` (device) | 15.2 ms | 6.7 ms | 27 B | 17 B |

Six independent exchange types, both directions: **~17–36 bytes**. Not 8, and not 1024.
`sNormalPreambleLength` now defaults to **32 B (6.7 ms)** — the top of that band, still 32×
cheaper than the wake-up burst.

### 11.3 The ladder

The binary `SHORT_OK` / `NEEDS_LONG` classification assumed a device either needs waking or
does not. Margin is continuous, so it is now a per-device rung:

| Level | Preamble | Airtime |
|---:|---:|---:|
| 0 | `sNormalPreambleLength` (32 B) | 6.7 ms |
| 1 | 4 × normal (128 B) | 26.7 ms |
| 2 | `LONG_PREAMBLE_LENGTH` (1024 B) | 213.3 ms |

- **Both legs** use the device's current rung, and **retries climb**: attempt *n* transmits at
  `min(level + n, 2)`. A marginal link costs one extra attempt instead of failing outright.
- Every transmitted frame feeds back: `PREAMBLE_FAILURES_TO_PROMOTE` (2) consecutive misses at
  the current rung climbs one; `PREAMBLE_SUCCESSES_TO_DEMOTE` (20) consecutive hits drops back
  down to retest the cheaper rung. Results from a rung the device is no longer on are ignored.
- A weak device settles at 26.7 ms rather than being pinned at 213 ms, and recovers by itself
  if conditions improve.

`io_preamble normal <bytes>` sweeps level 0 at runtime; the whole ladder scales with it.

### 11.4 Policy semantics now

- **`adaptive`** (default) — pure ladder, no awake window. The E468A9 failure happened 3 ms
  after the device's own transmission, so time-since-last-contact carries no information.
- **`wakefirst`** — the original hypothesis, still testable: wake-up burst on a cold request
  (>5 s since the last completed exchange), ladder otherwise.
- **`legacy`** — `CTRL1_LOW_POWER` decides, as before.

### 11.5 What to watch next

`Preamble: <id> up to level N` / `down to level N` lines show the ladder converging. Expect
most devices to sit at level 0 and stay there. If a device oscillates between rungs, level 0
is marginal for it and `io_preamble normal 48` (or 64) is the thing to try before concluding
anything about that device.

The still-open §9.5/§9.6 matter more now than they did in §10.6: every exchange is pinned to
`FREQUENCY_CHANNEL_2`, so a channel-specific collision is indistinguishable from a margin
problem and will push a healthy device up the ladder.
