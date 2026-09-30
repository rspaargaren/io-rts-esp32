import { FAVORITE_POSITION_STORAGE_PREFIX } from "../../models/Constants";
import type { Device } from "../../models/Types.ts";

export { DEVICE_TYPES, MANUFACTURERS } from "../../models/Constants";
export type { DeviceRowProps } from "../../models/Types.ts";

export function getFavPos(id: string): number | null {
  const v = localStorage.getItem(FAVORITE_POSITION_STORAGE_PREFIX + id);
  return v !== null ? parseInt(v, 10) : null;
}

export function setFavPos(id: string, pos: number): void {
  localStorage.setItem(FAVORITE_POSITION_STORAGE_PREFIX + id, String(pos));
}

export async function postAction(
  deviceId: string,
  action: string,
  otaKey: string,
  value?: unknown,
): Promise<{ success?: boolean; message?: string; deviceId?: string }> {
  const payload: Record<string, unknown> = { action };
  if (deviceId) payload.deviceId = deviceId;
  if (value !== undefined) {
    if (typeof value === "object" && value !== null) {
      Object.assign(payload, value);
    } else {
      payload.value = value;
    }
  }

  return fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OTA-Key": otaKey },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

export function getDeviceGroup(device: Device): string {
  const SHUTTER = [
    "ROLLER_SHUTTER",
    "BLIND",
    "DUAL_SHUTTER",
    "AWNING",
    "HORIZONTAL_AWNING",
    "EXTERNAL_VENETIAN_BLIND",
    "CURTAIN_TRACK",
    "SWINGING_SHUTTER",
  ];
  const VENETIAN = ["VENETIAN_BLIND", "LOUVRE_BLIND"];
  const WINDOW = ["WINDOW_OPENER"];
  const GATE = ["GARAGE_OPENER", "GATE_OPENER", "ROLLING_DOOR_OPENER"];
  const type = (device.type_name || "UNKNOWN")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (SHUTTER.includes(type)) return "shutter";
  if (VENETIAN.includes(type)) return "venetian";
  if (WINDOW.includes(type)) return "window";
  if (GATE.includes(type)) return "gate";
  if (type === "ON_OFF_SWITCH") return "switch";
  if (type === "LIGHT") return device.subtype === 58 ? "switch" : "dimmer";
  return "readonly";
}
