#!/usr/bin/env python3
"""
io-rts-esp32 stress test
Simulates Home Assistant (MQTT) and browser (HTTP + WebSocket) load to surface bugs.

Usage:
    python3 tools/stress_test.py [--scenarios ws_storm,mqtt_rapid,...] [--duration 120]

Devices used:
    5DA31C  Screen_Gijs      (2W)
    8D794B  Screen_Tom_Tuin  (1W)

33303C (Luifel Tuin) is hardcoded forbidden — never commanded under any circumstance.

Requirements:
    pip install aiohttp websockets paho-mqtt
"""

import argparse
import asyncio
import json
import logging
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import aiohttp
import paho.mqtt.client as mqtt
import websockets

# ── Config ────────────────────────────────────────────────────────────────────

DEVICE_IP   = "192.168.178.57"
BASE_URL    = f"http://{DEVICE_IP}"
WS_URL      = f"ws://{DEVICE_IP}/ws"

MQTT_HOST   = "192.168.178.150"
MQTT_PORT   = 1883
MQTT_USER   = "somfymqtt"
MQTT_PASS   = "Fsn74@msq26"
MQTT_PREFIX        = "io-rts"
MQTT_DEVICE_PREFIX = "io_"   # device topics use io-rts/io_<ID>/set etc.

TEST_DEVICES = {
    "5DA31C": "Screen_Gijs (2W)",
    "8D794B": "Screen_Tom_Tuin (1W)",
}
FORBIDDEN = {"33303C"}  # Luifel Tuin — NEVER touch

# ── ANSI colors ───────────────────────────────────────────────────────────────

R   = "\033[91m"
G   = "\033[92m"
Y   = "\033[93m"
B   = "\033[94m"
C   = "\033[96m"
W   = "\033[97m"
DIM = "\033[2m"
RST = "\033[0m"


def log(color: str, tag: str, msg: str):
    ts = time.strftime("%H:%M:%S")
    print(f"{DIM}{ts}{RST} {color}[{tag:12s}]{RST} {msg}", flush=True)


# ── Stats ─────────────────────────────────────────────────────────────────────

@dataclass
class Stats:
    scenario: str
    cmd_sent:           int = 0
    cmd_ok:             int = 0
    cmd_fail:           int = 0
    ws_connects:        int = 0
    ws_disconnects:     int = 0
    ws_errors:          int = 0
    mqtt_sent:          int = 0
    mqtt_state_rx:      int = 0
    stuck_count:        int = 0
    latencies_ms:       list = field(default_factory=list)

    def record_latency(self, ms: float):
        self.latencies_ms.append(ms)

    def summary(self) -> str:
        lat = self.latencies_ms
        if lat:
            lat_str = f"lat min/avg/max={min(lat):.0f}/{sum(lat)/len(lat):.0f}/{max(lat):.0f}ms"
        else:
            lat_str = "no latency data"
        return (
            f"cmds={self.cmd_sent} ok={self.cmd_ok} fail={self.cmd_fail} | "
            f"ws_conn={self.ws_connects} ws_err={self.ws_errors} | "
            f"mqtt_sent={self.mqtt_sent} state_rx={self.mqtt_state_rx} stuck={self.stuck_count} | "
            f"{lat_str}"
        )


# ── Safety guard ──────────────────────────────────────────────────────────────

def _guard(device_id: str):
    if device_id in FORBIDDEN:
        raise RuntimeError(
            f"SAFETY VIOLATION: attempted to command forbidden device {device_id} (Luifel Tuin)"
        )


# ── OTA key ───────────────────────────────────────────────────────────────────

async def get_ota_key(session: aiohttp.ClientSession) -> str:
    async with session.get(f"{BASE_URL}/api/ota/key", timeout=aiohttp.ClientTimeout(total=5)) as r:
        data = await r.json(content_type=None)
        return data["key"]


async def wait_for_device(session: aiohttp.ClientSession, timeout_s: float = 60.0) -> bool:
    """Poll /api/info until the device responds or timeout_s elapses. Returns True if up."""
    deadline = time.monotonic() + timeout_s
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            async with session.get(f"{BASE_URL}/api/info", timeout=aiohttp.ClientTimeout(total=3)) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        await asyncio.sleep(2)
    return False


# ── HTTP helpers ──────────────────────────────────────────────────────────────

async def http_action(
    session: aiohttp.ClientSession,
    ota_key: str,
    device_id: str,
    action: str,
    value: Optional[int] = None,
) -> bool:
    _guard(device_id)
    body: dict = {"deviceId": device_id, "action": action}
    if value is not None:
        body["value"] = value
    try:
        async with session.post(
            f"{BASE_URL}/api/action",
            json=body,
            headers={"X-OTA-Key": ota_key},
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            data = await r.json(content_type=None)
            return bool(data.get("success"))
    except Exception as e:
        log(R, "HTTP", f"action {action} {device_id} exception: {e}")
        return False


async def http_get_devices(session: aiohttp.ClientSession) -> list:
    try:
        async with session.get(
            f"{BASE_URL}/api/devices",
            timeout=aiohttp.ClientTimeout(total=5),
        ) as r:
            return await r.json(content_type=None)
    except Exception as e:
        log(R, "HTTP", f"GET /api/devices exception: {e}")
        return []


# ── MQTT bridge ───────────────────────────────────────────────────────────────

class MqttBridge:
    """Paho MQTT client in a background thread; state events forwarded via asyncio.Queue."""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self._q: asyncio.Queue = asyncio.Queue()
        self._client = mqtt.Client(client_id="io-rts-stress-test", clean_session=True)
        self._client.username_pw_set(MQTT_USER, MQTT_PASS)
        self._client.on_connect    = self._on_connect
        self._client.on_message    = self._on_message
        self._client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            log(G, "MQTT", "Connected to broker")
            for dev_id in TEST_DEVICES:
                client.subscribe(f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/state")
                client.subscribe(f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/position")
        else:
            log(R, "MQTT", f"Broker connect failed rc={rc}")

    def _on_message(self, client, userdata, msg):
        asyncio.run_coroutine_threadsafe(
            self._q.put({
                "topic":   msg.topic,
                "payload": msg.payload.decode(errors="replace"),
                "ts":      time.time(),
            }),
            self._loop,
        )

    def _on_disconnect(self, client, userdata, rc):
        if rc != 0:
            log(Y, "MQTT", f"Unexpected disconnect rc={rc}")

    def start(self):
        self._client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
        self._client.loop_start()

    def stop(self):
        self._client.loop_stop()
        self._client.disconnect()

    def publish(self, device_id: str, command: str):
        _guard(device_id)
        self._client.publish(f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{device_id}/set", command, qos=0)

    def publish_position(self, device_id: str, position: int):
        _guard(device_id)
        self._client.publish(f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{device_id}/set_position", str(position), qos=0)

    def drain_sync(self):
        """Discard any queued messages (call before a scenario to avoid stale data)."""
        while not self._q.empty():
            try:
                self._q.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def recv(self, timeout: float = 1.0) -> Optional[dict]:
        try:
            return await asyncio.wait_for(self._q.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None


# ── WebSocket client ──────────────────────────────────────────────────────────

async def ws_client_task(
    stats: Stats,
    duration: float,
    client_id: int,
    event_q: asyncio.Queue,
):
    """
    Persistent WebSocket client. Reconnects on close. Forwards non-ping messages
    to event_q so the calling scenario can observe them.
    """
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        try:
            async with websockets.connect(WS_URL, open_timeout=5, close_timeout=3) as ws:
                stats.ws_connects += 1
                log(C, f"WS-{client_id}", "connected")
                try:
                    while time.monotonic() < deadline:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                            msg = json.loads(raw)
                            t = msg.get("type", "")
                            if t not in ("ping", "init"):
                                log(C, f"WS-{client_id}", f"← {raw[:120]}")
                                await event_q.put({"src": "ws", "client": client_id, "msg": msg, "ts": time.time()})
                        except asyncio.TimeoutError:
                            pass  # normal keepalive gap
                except websockets.ConnectionClosed as e:
                    stats.ws_disconnects += 1
                    log(Y, f"WS-{client_id}", f"closed by server: {e}")
        except Exception as e:
            stats.ws_errors += 1
            log(R, f"WS-{client_id}", f"error: {e}")
            await asyncio.sleep(1.5)


# ══════════════════════════════════════════════════════════════════════════════
# Scenarios
# ══════════════════════════════════════════════════════════════════════════════

async def _ws_cycling_client(
    stats: Stats,
    duration: float,
    client_id: int,
    event_q: asyncio.Queue,
    hold_min: float = 4.0,
    hold_max: float = 8.0,
):
    """
    Connects, holds for a random interval, then disconnects and reconnects.
    Creates the fd-churn that triggers the fd-reuse/ESP_ERR_INVALID_ARG bug.
    """
    import random
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        hold = random.uniform(hold_min, hold_max)
        try:
            async with websockets.connect(WS_URL, open_timeout=5, close_timeout=3) as ws:
                stats.ws_connects += 1
                log(C, f"WS-{client_id}", f"connected (hold {hold:.1f}s)")
                try:
                    end = time.monotonic() + hold
                    while time.monotonic() < min(end, deadline):
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            msg = json.loads(raw)
                            if msg.get("type") not in ("ping", "init"):
                                log(C, f"WS-{client_id}", f"← {raw[:100]}")
                                await event_q.put({"src": "ws", "client": client_id, "msg": msg, "ts": time.time()})
                        except asyncio.TimeoutError:
                            pass
                except websockets.ConnectionClosed:
                    stats.ws_disconnects += 1
                    log(Y, f"WS-{client_id}", "closed by server")
            # intentional disconnect — small gap before reconnect
            await asyncio.sleep(0.5)
        except Exception as e:
            stats.ws_errors += 1
            log(R, f"WS-{client_id}", f"error: {e}")
            await asyncio.sleep(1.5)


async def scenario_ws_storm(
    session: aiohttp.ClientSession,
    bridge: MqttBridge,
    ota_key: str,
    duration: float,
) -> Stats:
    """
    4 WebSocket clients (device limit) cycling with random hold times to create
    fd-reuse churn. Commands flow in from MQTT and HTTP while clients connect and
    disconnect. Targets ESP_ERR_INVALID_ARG in ws_send_job_fn when a recycled fd
    gets a queued send from the previous connection's job queue.
    """
    stats = Stats("ws_storm")
    event_q: asyncio.Queue = asyncio.Queue()
    log(Y, "ws_storm", f"Starting — {duration}s, 4 cycling WS clients (device limit) + commands every 3s")

    # 4 clients = exactly WS_MAX_CLIENTS, so the device is always at capacity
    # Random hold times mean fds are recycled frequently
    ws_tasks = [
        asyncio.create_task(_ws_cycling_client(stats, duration, i, event_q, hold_min=3.0, hold_max=7.0))
        for i in range(4)
    ]

    await asyncio.sleep(2)  # let WS clients establish

    devices  = list(TEST_DEVICES.keys())
    cmds     = ["open", "close", "stop"]
    deadline = time.monotonic() + duration
    idx      = 0

    while time.monotonic() < deadline:
        dev_id = devices[idx % len(devices)]
        action = cmds[(idx // len(devices)) % len(cmds)]
        idx += 1

        if idx % 2 == 0:
            # HTTP path — simulates web UI button
            ok = await http_action(session, ota_key, dev_id, action)
            stats.cmd_sent += 1
            if ok:
                stats.cmd_ok += 1
                log(W, "HTTP→dev", f"{action.upper()} {dev_id} ({TEST_DEVICES[dev_id]}) → ok")
            else:
                stats.cmd_fail += 1
                log(R, "HTTP→dev", f"{action.upper()} {dev_id} → FAIL")
        else:
            # MQTT path — simulates HA
            bridge.publish(dev_id, action.upper())
            stats.mqtt_sent += 1
            log(B, "MQTT→dev", f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/set = {action.upper()}")

        await asyncio.sleep(3)

    for t in ws_tasks:
        t.cancel()
    await asyncio.gather(*ws_tasks, return_exceptions=True)
    return stats


async def scenario_mqtt_rapid(
    bridge: MqttBridge,
    duration: float,
) -> Stats:
    """
    Rapid OPEN → CLOSE → STOP cycles via MQTT for both devices, alternating.
    Measures command-to-state-update latency. Reports if state never arrives.
    """
    stats = Stats("mqtt_rapid")
    bridge.drain_sync()
    log(Y, "mqtt_rapid", f"Starting — {duration}s, OPEN/CLOSE/STOP alternating both devices")

    # command → send timestamp for latency tracking
    pending: dict[str, float] = {}

    async def drain_states(timeout: float = 0.5):
        while True:
            ev = await bridge.recv(timeout=timeout)
            if ev is None:
                break
            topic = ev["topic"]
            for dev_id in TEST_DEVICES:
                if f"/{MQTT_DEVICE_PREFIX}{dev_id}/" in topic:
                    stats.mqtt_state_rx += 1
                    if dev_id in pending:
                        lat_ms = (ev["ts"] - pending.pop(dev_id)) * 1000
                        stats.record_latency(lat_ms)
                        log(G, "MQTT←dev", f"{dev_id} state/pos in {lat_ms:.0f}ms  ({topic}={ev['payload']})")
                    else:
                        log(G, "MQTT←dev", f"{dev_id}  ({topic}={ev['payload']})")

    devices  = list(TEST_DEVICES.keys())
    cmds     = ["OPEN", "CLOSE", "STOP"]
    deadline = time.monotonic() + duration
    ci       = 0

    while time.monotonic() < deadline:
        dev_id = devices[ci % len(devices)]
        cmd    = cmds[(ci // len(devices)) % len(cmds)]
        ci += 1

        if cmd != "STOP":
            pending[dev_id] = time.time()
        bridge.publish(dev_id, cmd)
        stats.mqtt_sent += 1
        log(B, "MQTT→dev", f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/set = {cmd}")

        await drain_states(timeout=0.3)
        await asyncio.sleep(4)

    # final drain — wait up to 5s for any last state updates
    log(DIM, "mqtt_rapid", "Final drain…")
    await drain_states(timeout=5.0)

    unreplied = list(pending.keys())
    if unreplied:
        log(R, "mqtt_rapid", f"No state received for: {unreplied}")
        stats.stuck_count += len(unreplied)

    return stats


async def scenario_position_track_1w(
    bridge: MqttBridge,
    duration: float,
) -> Stats:
    """
    1W position interpolation test: OPEN Screen_Tom_Tuin then CLOSE.
    Watches MQTT position updates each second and flags if stuck (no update > 10s).
    This targets the v2.0.38 regression where UNKNOWN_POSITION blocked all interpolation.
    """
    stats = Stats("position_track_1w")
    dev_id = "8D794B"
    bridge.drain_sync()
    log(Y, "pos_track_1w", f"Starting — {duration}s tracking {dev_id} ({TEST_DEVICES[dev_id]})")

    async def watch(label: str, watch_dur: float):
        deadline = time.monotonic() + watch_dur
        last_pos: Optional[int] = None
        last_update = time.time()
        stuck_warned = False

        while time.monotonic() < deadline:
            ev = await bridge.recv(timeout=1.0)
            now = time.time()

            if ev:
                topic   = ev["topic"]
                payload = ev["payload"]
                if f"/{MQTT_DEVICE_PREFIX}{dev_id}/position" in topic:
                    try:
                        pos = int(float(payload))
                    except ValueError:
                        continue
                    if pos != last_pos:
                        log(G, f"1W[{label}]", f"position={pos}%  (was {last_pos})")
                        last_pos    = pos
                        last_update = now
                        stuck_warned = False
                        stats.mqtt_state_rx += 1
                    else:
                        log(DIM, f"1W[{label}]", f"position={pos}% (unchanged)")
                elif f"/{MQTT_DEVICE_PREFIX}{dev_id}/state" in topic:
                    log(C, f"1W[{label}]", f"state={payload}")
                    stats.mqtt_state_rx += 1

            # Stuck: no position update in 10s after command was sent
            if now - last_update > 10.0 and not stuck_warned:
                log(R, f"1W[{label}]", f"STUCK — no position update for >10s (last={last_pos})")
                stats.stuck_count += 1
                stuck_warned = True

    half = duration / 2

    log(B, "MQTT→dev", f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/set = OPEN")
    bridge.publish(dev_id, "OPEN")
    stats.mqtt_sent += 1
    await watch("OPEN", half)

    log(B, "MQTT→dev", f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{dev_id}/set = CLOSE")
    bridge.publish(dev_id, "CLOSE")
    stats.mqtt_sent += 1
    await watch("CLOSE", half)

    return stats


async def scenario_mixed_load(
    session: aiohttp.ClientSession,
    bridge: MqttBridge,
    ota_key: str,
    duration: float,
) -> Stats:
    """
    Simultaneous: 4 WS clients + MQTT commands at 0.2 Hz + HTTP /api/devices at 0.5 Hz.
    Reproduces combined channel pressure — the realistic HA + open-browser-UI scenario.
    """
    stats = Stats("mixed_load")
    event_q: asyncio.Queue = asyncio.Queue()
    log(Y, "mixed_load", f"Starting — {duration}s, WS×4 + MQTT@0.2Hz + HTTP@0.5Hz")

    ws_tasks = [
        asyncio.create_task(ws_client_task(stats, duration, i, event_q))
        for i in range(4)
    ]

    devices  = list(TEST_DEVICES.keys())
    cmds     = ["OPEN", "CLOSE", "STOP"]
    deadline = time.monotonic() + duration

    async def mqtt_sender():
        idx = 0
        while time.monotonic() < deadline:
            dev_id = devices[idx % len(devices)]
            cmd    = cmds[(idx // len(devices)) % len(cmds)]
            bridge.publish(dev_id, cmd)
            stats.mqtt_sent += 1
            log(B, "MQTT→dev", f"{dev_id}/set = {cmd}")
            idx += 1
            await asyncio.sleep(5)  # 0.2 Hz

    async def http_poller():
        while time.monotonic() < deadline:
            devs = await http_get_devices(session)
            if devs:
                positions = {d["id"]: d.get("position") for d in devs if d["id"] in TEST_DEVICES}
                log(W, "HTTP←dev", f"/api/devices ok — positions: {positions}")
            else:
                stats.cmd_fail += 1
                log(R, "HTTP←dev", "/api/devices FAILED")
            await asyncio.sleep(2)  # 0.5 Hz

    async def state_drain():
        while time.monotonic() < deadline:
            ev = await bridge.recv(timeout=1.0)
            if ev:
                stats.mqtt_state_rx += 1
                log(G, "MQTT←dev", f"{ev['topic']} = {ev['payload']}")

    await asyncio.gather(
        *ws_tasks,
        mqtt_sender(),
        http_poller(),
        state_drain(),
    )
    return stats


async def scenario_socket_soak(
    session: aiohttp.ClientSession,
    bridge: MqttBridge,
    ota_key: str,
    duration: float,
) -> Stats:
    """
    Low-rate commands (1/min) over a long period with 2 persistent WS clients.
    Polls /api/debug every 10 minutes to catch ENFILE (socket exhaustion) symptoms.
    Default duration: 1800s (30 min). Run longer (e.g. --duration 7200) to stress test.
    """
    stats = Stats("socket_soak")
    event_q: asyncio.Queue = asyncio.Queue()
    log(Y, "socket_soak", f"Starting — {duration}s low-rate soak with 2 WS clients")

    ws_tasks = [
        asyncio.create_task(ws_client_task(stats, duration, i, event_q))
        for i in range(2)
    ]

    devices  = list(TEST_DEVICES.keys())
    cmds     = ["OPEN", "CLOSE", "STOP"]
    deadline = time.monotonic() + duration
    tick     = 0

    while time.monotonic() < deadline:
        dev_id = devices[tick % len(devices)]
        cmd    = cmds[(tick // len(devices)) % len(cmds)]
        bridge.publish(dev_id, cmd)
        stats.mqtt_sent += 1
        log(B, "MQTT→dev", f"soak tick={tick}  {dev_id}/set = {cmd}")
        tick += 1

        # Poll /api/debug every 10 ticks (~10 min at 60s interval)
        if tick % 10 == 0:
            try:
                async with session.get(
                    f"{BASE_URL}/api/debug",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as r:
                    body = await r.text()
                    log(W, "HTTP←dev", f"/api/debug {len(body)} bytes (tick={tick}, uptime≈{tick}min)")
                    # Heuristic: if response is much smaller than expected, device may be degraded
                    if len(body) < 100:
                        log(R, "socket_soak", f"Suspiciously short /api/debug response ({len(body)} bytes) — possible ENFILE")
                        stats.cmd_fail += 1
            except Exception as e:
                log(R, "socket_soak", f"/api/debug FAILED (tick={tick}): {e}")
                stats.cmd_fail += 1

        # Drain state queue without blocking the sleep
        now = time.monotonic()
        while time.monotonic() - now < 1.0:
            ev = await bridge.recv(timeout=0.5)
            if ev:
                stats.mqtt_state_rx += 1

        await asyncio.sleep(max(0, 60 - (time.monotonic() - now)))

    for t in ws_tasks:
        t.cancel()
    await asyncio.gather(*ws_tasks, return_exceptions=True)
    return stats


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

SCENARIOS: dict[str, tuple] = {
    "ws_storm":          (scenario_ws_storm,          True,  90),
    "mqtt_rapid":        (scenario_mqtt_rapid,         False, 120),
    "position_track_1w": (scenario_position_track_1w,  False, 90),
    "mixed_load":        (scenario_mixed_load,          True,  120),
    "socket_soak":       (scenario_socket_soak,         True,  1800),
}
# True = needs (session, bridge, ota_key, duration); False = needs (bridge, duration)

DEFAULT_SUITE = "ws_storm,mqtt_rapid,position_track_1w,mixed_load"


async def main(chosen: list[str], duration_override: Optional[int]):
    loop = asyncio.get_running_loop()
    bridge = MqttBridge(loop)
    bridge.start()
    await asyncio.sleep(1.5)  # MQTT connect

    async with aiohttp.ClientSession() as session:
        log(W, "startup", f"Fetching OTA key from {BASE_URL} …")
        try:
            ota_key = await get_ota_key(session)
            log(G, "startup", f"OTA key acquired: {ota_key[:8]}…")
        except Exception as e:
            log(R, "startup", f"Could not get OTA key: {e} — HTTP actions will fail")
            ota_key = "UNKNOWN"

        all_stats: list[Stats] = []

        for name in chosen:
            fn, needs_http, default_dur = SCENARIOS[name]
            dur = duration_override if duration_override is not None else default_dur

            print()
            log(Y, "RUN", f"{'━' * 50}")
            log(Y, "RUN", f"  Scenario: {name}  ({dur}s)")
            log(Y, "RUN", f"{'━' * 50}")

            try:
                if needs_http:
                    stats = await fn(session, bridge, ota_key, dur)
                else:
                    stats = await fn(bridge, dur)
            except Exception as e:
                import traceback
                log(R, "RUN", f"{name} crashed: {e}")
                traceback.print_exc()
                stats = Stats(name)
                stats.cmd_fail += 1

            all_stats.append(stats)
            log(G, "DONE", f"{name}: {stats.summary()}")

            if chosen.index(name) < len(chosen) - 1:
                log(Y, "recovery", "Waiting for device to recover before next scenario…")
                if await wait_for_device(session, timeout_s=60.0):
                    log(G, "recovery", "Device up — continuing")
                    await asyncio.sleep(3)
                else:
                    log(R, "recovery", "Device did not recover within 60s — stopping test suite")

    bridge.stop()

    print()
    print("═" * 72)
    print("  STRESS TEST SUMMARY")
    print("═" * 72)
    any_fail = False
    for s in all_stats:
        bad = s.cmd_fail > 0 or s.ws_errors > 0 or s.stuck_count > 0
        if bad:
            any_fail = True
        color = R if bad else G
        print(f"  {color}{s.scenario:<22}{RST}  {s.summary()}")
    print("═" * 72)
    if any_fail:
        print(f"\n{R}Issues found — check logs above for details.{RST}")
    else:
        print(f"\n{G}All scenarios passed without errors.{RST}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="io-rts-esp32 stress test — HA (MQTT) + browser (HTTP+WS) load",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"Available scenarios: {', '.join(SCENARIOS)}\nDefault suite: {DEFAULT_SUITE}",
    )
    parser.add_argument(
        "--scenarios", "-s",
        default=DEFAULT_SUITE,
        help="Comma-separated scenarios to run (default: all except socket_soak)",
    )
    parser.add_argument(
        "--duration", "-d",
        type=int,
        default=None,
        help="Override duration for ALL scenarios (seconds)",
    )
    args = parser.parse_args()

    chosen = [s.strip() for s in args.scenarios.split(",") if s.strip()]
    unknown = [s for s in chosen if s not in SCENARIOS]
    if unknown:
        print(f"Unknown scenarios: {unknown}\nAvailable: {list(SCENARIOS)}")
        sys.exit(1)

    logging.basicConfig(level=logging.WARNING)

    try:
        asyncio.run(main(chosen, args.duration))
    except KeyboardInterrupt:
        print(f"\n{Y}Interrupted.{RST}")
