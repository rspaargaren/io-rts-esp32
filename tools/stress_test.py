#!/usr/bin/env python3
"""
io-rts-esp32 real-world integration test
Tests everyday usage: browser UI, Home Assistant MQTT, simultaneous access,
WebSocket reconnect, and live position push — the scenarios users actually run.

Usage:
    python3 tools/stress_test.py [--scenarios daily_browser,daily_ha,...] [--duration 120]
    python3 tools/stress_test.py  # runs all scenarios

Scenarios:
    daily_browser  — One WS client + HTTP commands, like a user at the UI
    daily_ha       — MQTT commands + state update confirmation, like HA automations
    simultaneous   — Browser HTTP + HA MQTT at the same time on different devices
    ws_reconnect   — Tab refresh: WS disconnect/reconnect cycle, slot reuse check
    position_push  — Send open command, verify position update arrives via WS

Devices:
    5DA31C  Screen_Gijs      (2W, always on)
    8D794B  Screen_Tom_Tuin  (1W, low-power)
    33303C  Luifel Tuin      — FORBIDDEN, never commanded

Requirements:
    pip install aiohttp websockets paho-mqtt
"""

import argparse
import asyncio
import json
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

MQTT_HOST          = "192.168.178.150"
MQTT_PORT          = 1883
MQTT_USER          = "somfymqtt"
MQTT_PASS          = "Fsn74@msq26"
MQTT_PREFIX        = "io-rts"
MQTT_DEVICE_PREFIX = "io_"

TEST_DEVICES = {
    "5DA31C": "Screen_Gijs (2W)",
    "8D794B": "Screen_Tom_Tuin (1W)",
}
FORBIDDEN = {"33303C"}  # Luifel Tuin — NEVER touch, EVER

HTTP_TIMEOUT = 15   # seconds — realistic for home use
MQTT_STATE_TIMEOUT = 20  # seconds — time to wait for MQTT state update after command

# ── Console colours ───────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
CYAN   = "\033[96m"
WHITE  = "\033[97m"

def ts() -> str:
    return time.strftime("%H:%M:%S")

def log(color: str, tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {color}{BOLD}[{tag:<14}]{RESET} {msg}", flush=True)

def log_ok(tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {GREEN}{BOLD}[{tag:<14}]{RESET} {GREEN}✓ {msg}{RESET}", flush=True)

def log_fail(tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {RED}{BOLD}[{tag:<14}]{RESET} {RED}✗ {msg}{RESET}", flush=True)

def log_info(tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {BLUE}{BOLD}[{tag:<14}]{RESET} {msg}", flush=True)

def log_ws(tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {CYAN}{BOLD}[{tag:<14}]{RESET} {msg}", flush=True)

def log_mqtt(tag: str, msg: str):
    print(f"{DIM}{ts()}{RESET} {YELLOW}{BOLD}[{tag:<14}]{RESET} {msg}", flush=True)

def section(title: str):
    bar = "─" * (60 - len(title) - 3)
    print(f"\n{BOLD}{WHITE}── {title} {bar}{RESET}", flush=True)


# ── Safety guard ──────────────────────────────────────────────────────────────

def _guard(device_id: str):
    if device_id in FORBIDDEN:
        raise RuntimeError(
            f"SAFETY VIOLATION: attempted to command forbidden device {device_id} (Luifel Tuin)"
        )


# ── Test result tracking ──────────────────────────────────────────────────────

@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""

@dataclass
class ScenarioResult:
    name: str
    checks: list = field(default_factory=list)
    latencies_ms: list = field(default_factory=list)

    def add(self, name: str, passed: bool, detail: str = ""):
        c = Check(name, passed, detail)
        self.checks.append(c)
        if passed:
            log_ok(self.name, f"{name}{(' — ' + detail) if detail else ''}")
        else:
            log_fail(self.name, f"{name}{(' — ' + detail) if detail else ''}")
        return passed

    def record_latency(self, ms: float):
        self.latencies_ms.append(ms)

    def print_summary(self):
        passed = sum(1 for c in self.checks if c.passed)
        total  = len(self.checks)
        lat    = self.latencies_ms
        lat_str = (
            f"latency min/avg/max = {min(lat):.0f}/{sum(lat)/len(lat):.0f}/{max(lat):.0f} ms"
            if lat else "no latency data"
        )
        status_color = GREEN if passed == total else RED
        print(
            f"\n  {status_color}{BOLD}{passed}/{total} checks passed{RESET}  {DIM}{lat_str}{RESET}",
            flush=True
        )
        for c in self.checks:
            mark = f"{GREEN}✓{RESET}" if c.passed else f"{RED}✗{RESET}"
            detail = f" {DIM}({c.detail}){RESET}" if c.detail else ""
            print(f"    {mark} {c.name}{detail}", flush=True)
        return passed == total


# ── OTA key ───────────────────────────────────────────────────────────────────

async def get_ota_key(session: aiohttp.ClientSession) -> str:
    async with session.get(f"{BASE_URL}/api/ota/key", timeout=aiohttp.ClientTimeout(total=5)) as r:
        return (await r.json(content_type=None))["key"]


async def wait_for_device(session: aiohttp.ClientSession, timeout_s: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
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
) -> tuple[bool, float]:
    """Send action, return (success, latency_ms)."""
    _guard(device_id)
    body: dict = {"deviceId": device_id, "action": action}
    if value is not None:
        body["value"] = value
    t0 = time.monotonic()
    try:
        async with session.post(
            f"{BASE_URL}/api/action",
            json=body,
            headers={"X-OTA-Key": ota_key},
            timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT),
        ) as r:
            data = await r.json(content_type=None)
            ms = (time.monotonic() - t0) * 1000
            ok = bool(data.get("success"))
            msg = data.get("message", "")
            label = f"{action.upper()} {device_id} ({TEST_DEVICES.get(device_id, '?')})"
            if ok:
                log_ok("HTTP→dev", f"{label}  {DIM}{ms:.0f} ms{RESET}")
            else:
                log_fail("HTTP→dev", f"{label}  {DIM}{ms:.0f} ms — {msg}{RESET}")
            return ok, ms
    except asyncio.TimeoutError:
        ms = (time.monotonic() - t0) * 1000
        log_fail("HTTP→dev", f"{action.upper()} {device_id} — timeout after {ms:.0f} ms")
        return False, ms
    except Exception as e:
        ms = (time.monotonic() - t0) * 1000
        log_fail("HTTP→dev", f"{action.upper()} {device_id} — {e}")
        return False, ms


async def http_get_devices(session: aiohttp.ClientSession) -> list:
    try:
        async with session.get(f"{BASE_URL}/api/devices", timeout=aiohttp.ClientTimeout(total=5)) as r:
            return await r.json(content_type=None)
    except Exception:
        return []


# ── MQTT bridge ───────────────────────────────────────────────────────────────

class MqttBridge:
    def __init__(self):
        self._client = mqtt.Client(client_id="io-rts-stress-test", protocol=mqtt.MQTTv311)
        self._client.username_pw_set(MQTT_USER, MQTT_PASS)
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message    = self._on_message
        self._connected = False
        self._state_callbacks: list = []   # list of (device_id, asyncio.Event, result_dict)
        self._loop = None

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            client.subscribe(f"{MQTT_PREFIX}/#")
            log_mqtt("MQTT", f"Connected to {MQTT_HOST}:{MQTT_PORT}, subscribed to {MQTT_PREFIX}/#")
        else:
            log_fail("MQTT", f"Connect failed rc={rc}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        if rc != 0:
            log_fail("MQTT", f"Unexpected disconnect rc={rc}")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode(errors="replace")
        # State topics: io-rts/io_<ID>/state
        if "/state" in topic:
            parts = topic.split("/")
            if len(parts) >= 2:
                dev_suffix = parts[-2]  # io_XXXXXX
                dev_id = dev_suffix[3:].upper() if dev_suffix.startswith("io_") else None
                log_mqtt("MQTT←dev", f"{topic} = {payload[:80]}")
                if dev_id and self._loop:
                    for entry in self._state_callbacks:
                        if entry["device_id"] == dev_id and not entry["fired"]:
                            entry["fired"] = True
                            entry["payload"] = payload
                            self._loop.call_soon_threadsafe(entry["event"].set)

    def connect(self, loop):
        self._loop = loop
        self._client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
        self._client.loop_start()

    def disconnect(self):
        self._client.loop_stop()
        self._client.disconnect()

    def publish(self, device_id: str, command: str):
        _guard(device_id)
        topic = f"{MQTT_PREFIX}/{MQTT_DEVICE_PREFIX}{device_id}/set"
        self._client.publish(topic, command, qos=0)
        log_mqtt("MQTT→dev", f"{topic} = {command}")

    def register_state_listener(self, device_id: str) -> dict:
        """Register a listener for the next state message from device_id. Returns entry dict."""
        entry = {"device_id": device_id, "event": asyncio.Event(), "fired": False, "payload": None}
        self._state_callbacks.append(entry)
        return entry

    def remove_state_listener(self, entry: dict):
        try:
            self._state_callbacks.remove(entry)
        except ValueError:
            pass

    @property
    def connected(self) -> bool:
        return self._connected


# ── WebSocket helper ──────────────────────────────────────────────────────────

async def ws_connect_and_hello(tag: str) -> tuple:
    """
    Connect to the WS endpoint and send {"type":"hello"}.
    Returns (websocket, init_received: bool).
    The hello frame triggers ws_handler on the device, populating the fd slot.
    """
    ws = await websockets.connect(WS_URL, open_timeout=10, close_timeout=5)
    log_ws(tag, "Connected")
    await ws.send(json.dumps({"type": "hello"}))
    log_ws(tag, 'Sent {"type":"hello"}')
    # Read the init frame the device sends back
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
        msg = json.loads(raw)
        if msg.get("type") == "init":
            log_ws(tag, f'Received init ✓  {DIM}{raw}{RESET}')
            return ws, True
        else:
            log_ws(tag, f'Received unexpected: {raw[:80]}')
            return ws, False
    except asyncio.TimeoutError:
        log_fail(tag, "No init message received within 5 s")
        return ws, False


# ═══════════════════════════════════════════════════════════════════════════════
# Scenario: daily_browser
# One persistent WS session + HTTP commands, like a user working in the UI.
# ═══════════════════════════════════════════════════════════════════════════════

async def scenario_daily_browser(
    session: aiohttp.ClientSession,
    ota_key: str,
    duration: float,
) -> ScenarioResult:
    section("daily_browser — browser UI session")
    result = ScenarioResult("daily_browser")
    log_info("daily_browser", f"WS connect + hello, then HTTP commands every 15 s for {duration:.0f} s")

    ws, init_ok = await ws_connect_and_hello("WS")
    result.add("WS connected and received init", init_ok)

    ws_msgs_received = []
    ws_alive = True

    async def _ws_reader():
        nonlocal ws_alive
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=35.0)
                msg = json.loads(raw)
                ws_msgs_received.append(msg)
                mtype = msg.get("type", "?")
                if mtype not in ("ping",):  # skip routine pings from log
                    log_ws("WS←dev", f'{raw[:100]}')
        except asyncio.TimeoutError:
            log_fail("WS", "No message received for 35 s — connection may be stale")
            ws_alive = False
        except websockets.ConnectionClosed:
            log_fail("WS", "Connection closed unexpectedly")
            ws_alive = False
        except asyncio.CancelledError:
            pass

    reader = asyncio.create_task(_ws_reader())

    # Fetch device list — simulates page load
    devices = await http_get_devices(session)
    result.add("GET /api/devices returns data", len(devices) > 0, f"{len(devices)} devices")

    # Send open/close/stop commands on a 15-second cadence
    cmds   = ["open", "close", "stop", "open", "close"]
    devs   = list(TEST_DEVICES.keys())
    deadline = time.monotonic() + duration

    for i, action in enumerate(cmds):
        if time.monotonic() >= deadline:
            break
        dev_id = devs[i % len(devs)]
        log_info("daily_browser", f"[{i+1}/{len(cmds)}] Sending {action.upper()} → {TEST_DEVICES[dev_id]}")
        ok, ms = await http_action(session, ota_key, dev_id, action)
        result.add(f"HTTP {action} {TEST_DEVICES[dev_id]}", ok, f"{ms:.0f} ms")
        if ok:
            result.record_latency(ms)
        # Wait 15 s between commands, watching for WS messages
        wait_until = time.monotonic() + 15
        while time.monotonic() < wait_until and time.monotonic() < deadline:
            await asyncio.sleep(1)

    reader.cancel()
    await asyncio.gather(reader, return_exceptions=True)
    await ws.close()

    result.add("WS stayed connected throughout", ws_alive)
    pos_updates = [m for m in ws_msgs_received if m.get("type") == "position"]
    result.add("Received position updates via WS", len(pos_updates) > 0,
               f"{len(pos_updates)} position message(s)")

    result.print_summary()
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Scenario: daily_ha
# MQTT commands like HA automations, verify state updates come back.
# ═══════════════════════════════════════════════════════════════════════════════

async def scenario_daily_ha(
    bridge: MqttBridge,
    duration: float,
) -> ScenarioResult:
    section("daily_ha — Home Assistant MQTT automation")
    result = ScenarioResult("daily_ha")
    log_info("daily_ha", f"MQTT open/close commands every 15 s, expecting state updates within {MQTT_STATE_TIMEOUT} s")

    if not bridge.connected:
        result.add("MQTT connected", False, "broker unreachable")
        result.print_summary()
        return result
    result.add("MQTT connected", True)

    cmds  = [("5DA31C", "OPEN"), ("8D794B", "CLOSE"), ("5DA31C", "CLOSE"), ("8D794B", "OPEN")]
    deadline = time.monotonic() + duration

    for dev_id, cmd in cmds:
        if time.monotonic() >= deadline:
            break
        name = TEST_DEVICES[dev_id]
        log_info("daily_ha", f"Sending {cmd} → {name}")
        entry = bridge.register_state_listener(dev_id)
        t0 = time.monotonic()
        bridge.publish(dev_id, cmd)
        try:
            await asyncio.wait_for(entry["event"].wait(), timeout=MQTT_STATE_TIMEOUT)
            ms = (time.monotonic() - t0) * 1000
            result.add(f"MQTT state update for {name}", True, f"{ms:.0f} ms — {entry['payload'][:60]}")
            result.record_latency(ms)
        except asyncio.TimeoutError:
            result.add(f"MQTT state update for {name}", False,
                       f"no update within {MQTT_STATE_TIMEOUT} s")
        finally:
            bridge.remove_state_listener(entry)

        # 15 s between commands
        wait_until = time.monotonic() + 15
        while time.monotonic() < wait_until and time.monotonic() < deadline:
            await asyncio.sleep(1)

    result.print_summary()
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Scenario: simultaneous
# Browser HTTP command + HA MQTT command at the same time, different devices.
# ═══════════════════════════════════════════════════════════════════════════════

async def scenario_simultaneous(
    session: aiohttp.ClientSession,
    bridge: MqttBridge,
    ota_key: str,
    duration: float,
) -> ScenarioResult:
    section("simultaneous — browser + HA at same time")
    result = ScenarioResult("simultaneous")
    log_info("simultaneous", "HTTP action + MQTT command fired concurrently, 20 s apart")

    ws, init_ok = await ws_connect_and_hello("WS")
    result.add("WS connected", init_ok)

    pairs = [
        ("5DA31C", "open",  "8D794B", "CLOSE"),
        ("5DA31C", "close", "8D794B", "OPEN"),
        ("5DA31C", "stop",  "8D794B", "CLOSE"),
    ]
    deadline = time.monotonic() + duration

    for http_dev, http_action_name, mqtt_dev, mqtt_cmd in pairs:
        if time.monotonic() >= deadline:
            break
        log_info("simultaneous",
                 f"HTTP {http_action_name.upper()} {TEST_DEVICES[http_dev]}  +  "
                 f"MQTT {mqtt_cmd} {TEST_DEVICES[mqtt_dev]}  (concurrent)")

        entry = bridge.register_state_listener(mqtt_dev)
        t0 = time.monotonic()

        # Fire both at the same moment
        http_task  = asyncio.create_task(http_action(session, ota_key, http_dev, http_action_name))
        bridge.publish(mqtt_dev, mqtt_cmd)

        http_ok, http_ms = await http_task
        result.add(f"HTTP {http_action_name} {TEST_DEVICES[http_dev]}", http_ok, f"{http_ms:.0f} ms")
        if http_ok:
            result.record_latency(http_ms)

        try:
            await asyncio.wait_for(entry["event"].wait(), timeout=MQTT_STATE_TIMEOUT)
            ms = (time.monotonic() - t0) * 1000
            result.add(f"MQTT state for {TEST_DEVICES[mqtt_dev]}", True, f"{ms:.0f} ms")
        except asyncio.TimeoutError:
            result.add(f"MQTT state for {TEST_DEVICES[mqtt_dev]}", False,
                       f"no update within {MQTT_STATE_TIMEOUT} s")
        finally:
            bridge.remove_state_listener(entry)

        wait_until = time.monotonic() + 20
        while time.monotonic() < wait_until and time.monotonic() < deadline:
            await asyncio.sleep(1)

    await ws.close()
    result.print_summary()
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Scenario: ws_reconnect
# Simulates browser tab refresh: WS disconnect then reconnect, slot reuse check.
# ═══════════════════════════════════════════════════════════════════════════════

async def scenario_ws_reconnect(
    session: aiohttp.ClientSession,
    ota_key: str,
    cycles: int = 5,
) -> ScenarioResult:
    section("ws_reconnect — browser tab refresh / WS slot reuse")
    result = ScenarioResult("ws_reconnect")
    log_info("ws_reconnect", f"{cycles} disconnect → reconnect cycles, 3 s gap each")

    for i in range(1, cycles + 1):
        log_info("ws_reconnect", f"Cycle {i}/{cycles}")
        try:
            ws, init_ok = await ws_connect_and_hello(f"WS#{i}")
            result.add(f"Cycle {i}: connect + init", init_ok)
            await asyncio.sleep(3)
            await ws.close()
            log_ws(f"WS#{i}", "Closed")
            await asyncio.sleep(3)
        except Exception as e:
            result.add(f"Cycle {i}: connect + init", False, str(e))
            await asyncio.sleep(3)

    # After all reconnects, verify the device API still works
    devices = await http_get_devices(session)
    result.add("HTTP still responsive after reconnects", len(devices) > 0,
               f"{len(devices)} devices returned")

    result.print_summary()
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Scenario: position_push
# Send open, verify a position update arrives via WS (device → UI push).
# ═══════════════════════════════════════════════════════════════════════════════

async def scenario_position_push(
    session: aiohttp.ClientSession,
    ota_key: str,
) -> ScenarioResult:
    section("position_push — live position update via WebSocket")
    result = ScenarioResult("position_push")
    log_info("position_push", "Connect WS, send OPEN to Screen_Gijs, wait for position update")

    ws, init_ok = await ws_connect_and_hello("WS")
    result.add("WS connected + init", init_ok)
    if not init_ok:
        await ws.close()
        result.print_summary()
        return result

    pos_event  = asyncio.Event()
    pos_msgs   = []

    async def _reader():
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "position":
                    pos_msgs.append(msg)
                    log_ws("WS←dev", f"position update: {raw[:120]}")
                    pos_event.set()
        except (asyncio.TimeoutError, websockets.ConnectionClosed, asyncio.CancelledError):
            pass

    reader = asyncio.create_task(_reader())

    # Send open
    ok, ms = await http_action(session, ota_key, "5DA31C", "open")
    result.add("HTTP open Screen_Gijs", ok, f"{ms:.0f} ms")

    if ok:
        # Wait up to 15 s for a position update to arrive on WS
        try:
            await asyncio.wait_for(pos_event.wait(), timeout=15.0)
            first = pos_msgs[0]
            result.add(
                "Position update received via WS",
                True,
                f"id={first.get('id')} pos={first.get('position')}"
            )
        except asyncio.TimeoutError:
            result.add("Position update received via WS", False, "no update within 15 s")

    reader.cancel()
    await asyncio.gather(reader, return_exceptions=True)
    await ws.close()
    result.print_summary()
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

ALL_SCENARIOS = ["daily_browser", "daily_ha", "simultaneous", "ws_reconnect", "position_push"]


async def main(scenarios: list[str], duration: float):
    print(f"\n{BOLD}{WHITE}══════════════════════════════════════════════════════════{RESET}")
    print(f"{BOLD}{WHITE}  io-rts-esp32 real-world integration test{RESET}")
    print(f"{BOLD}{WHITE}  Device: {DEVICE_IP}   Scenarios: {', '.join(scenarios)}{RESET}")
    print(f"{BOLD}{WHITE}══════════════════════════════════════════════════════════{RESET}\n")

    connector = aiohttp.TCPConnector(limit=10)
    async with aiohttp.ClientSession(connector=connector) as session:
        log_info("setup", "Checking device is reachable...")
        if not await wait_for_device(session, timeout_s=15):
            log_fail("setup", f"Device {DEVICE_IP} not reachable — aborting")
            sys.exit(1)

        ota_key = await get_ota_key(session)
        log_ok("setup", f"Device up  key={ota_key}")

        loop    = asyncio.get_event_loop()
        bridge  = MqttBridge()
        bridge.connect(loop)
        await asyncio.sleep(2)  # let MQTT connect

        all_results = []

        for name in scenarios:
            if name == "daily_browser":
                r = await scenario_daily_browser(session, ota_key, duration)
            elif name == "daily_ha":
                r = await scenario_daily_ha(bridge, duration)
            elif name == "simultaneous":
                r = await scenario_simultaneous(session, bridge, ota_key, duration)
            elif name == "ws_reconnect":
                r = await scenario_ws_reconnect(session, ota_key, cycles=5)
            elif name == "position_push":
                r = await scenario_position_push(session, ota_key)
            else:
                log_fail("main", f"Unknown scenario: {name}")
                continue

            all_results.append(r)

            # Brief pause + device health check between scenarios
            if name != scenarios[-1]:
                log_info("health", "Pausing 5 s then checking device health...")
                await asyncio.sleep(5)
                devices = await http_get_devices(session)
                if devices:
                    log_ok("health", f"Device responsive — {len(devices)} devices known")
                else:
                    log_fail("health", "Device not responding after scenario — check logs")

        bridge.disconnect()

        # ── Final report ──────────────────────────────────────────────────────
        print(f"\n{BOLD}{WHITE}══════════════════════════════════════════════════════════{RESET}")
        print(f"{BOLD}{WHITE}  FINAL REPORT{RESET}")
        print(f"{BOLD}{WHITE}══════════════════════════════════════════════════════════{RESET}")

        overall_pass = True
        for r in all_results:
            total   = len(r.checks)
            passed  = sum(1 for c in r.checks if c.passed)
            ok_str  = f"{GREEN}PASS{RESET}" if passed == total else f"{RED}FAIL{RESET}"
            lat     = r.latencies_ms
            lat_str = f"avg {sum(lat)/len(lat):.0f} ms" if lat else "—"
            print(f"  {ok_str}  {BOLD}{r.name:<20}{RESET}  {passed}/{total} checks  {DIM}{lat_str}{RESET}")
            if passed < total:
                overall_pass = False
                for c in r.checks:
                    if not c.passed:
                        print(f"       {RED}✗ {c.name}{(' — ' + c.detail) if c.detail else ''}{RESET}")

        print(f"\n  {'=' * 54}")
        if overall_pass:
            print(f"  {GREEN}{BOLD}ALL SCENARIOS PASSED{RESET}")
        else:
            print(f"  {RED}{BOLD}SOME SCENARIOS FAILED — see details above{RESET}")
        print(f"  {'=' * 54}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="io-rts-esp32 real-world integration test")
    parser.add_argument(
        "--scenarios", default=",".join(ALL_SCENARIOS),
        help=f"Comma-separated scenarios to run (default: all). Options: {', '.join(ALL_SCENARIOS)}"
    )
    parser.add_argument(
        "--duration", type=float, default=90,
        help="Duration in seconds for time-bounded scenarios (default: 90)"
    )
    args = parser.parse_args()
    scenarios = [s.strip() for s in args.scenarios.split(",") if s.strip()]

    try:
        asyncio.run(main(scenarios, args.duration))
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Interrupted by user{RESET}")
