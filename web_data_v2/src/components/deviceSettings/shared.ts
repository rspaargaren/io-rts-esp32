import { Device } from "../../models/Types.ts";

export const DEVICE_TYPES = [
  [2, "Roller shutter"],
  [1, "Venetian blind"],
  [10, "Blind"],
  [13, "Dual shutter"],
  [3, "Awning"],
  [16, "Horizontal awning"],
  [24, "Swinging shutter"],
  [4, "Window opener"],
  [5, "Garage opener"],
  [7, "Gate opener"],
  [8, "Rolling door opener"],
  [6, "Light"],
  [15, "On/off switch"],
  [9, "Lock"],
  [0, "Unknown"],
] as const;

export const MANUFACTURERS = [
  [2, "Somfy"],
  [1, "Velux"],
  [3, "Honeywell"],
  [4, "Hörmann"],
  [5, "Assa Abloy"],
  [6, "Niko"],
  [7, "Window Master"],
  [8, "Renson"],
  [11, "Overkiz"],
  [12, "Atlantic Group"],
  [0, "Unknown"],
] as const;

const FAV_PREFIX = "fav_pos_";

export interface DeviceRowProps {
  device: Device;
  setDeviceState: (value: Device | ((prev: Device) => Device)) => void;
  onClose?: () => void;
}

export function getFavPos(id: string): number | null {
  const v = localStorage.getItem(FAV_PREFIX + id);
  return v !== null ? parseInt(v, 10) : null;
}

export function setFavPos(id: string, pos: number): void {
  localStorage.setItem(FAV_PREFIX + id, String(pos));
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

