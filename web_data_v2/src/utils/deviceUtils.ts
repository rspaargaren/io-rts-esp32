import { Device } from "../models/Types";

export type DeviceGroup =
  "shutter" | "venetian" | "window" | "gate" | "switch" | "dimmer" | "readonly";

export function getDeviceGroup(device: Device): DeviceGroup {
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

  const typeName = (device.type_name || "UNKNOWN")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (SHUTTER.indexOf(typeName) !== -1) return "shutter";
  if (VENETIAN.indexOf(typeName) !== -1) return "venetian";
  if (WINDOW.indexOf(typeName) !== -1) return "window";
  if (GATE.indexOf(typeName) !== -1) return "gate";
  if (typeName === "ON_OFF_SWITCH") return "switch";
  if (typeName === "LIGHT") return device.subtype === 58 ? "switch" : "dimmer";
  return "readonly";
}

export function deviceHasPosition(
  device: Device,
  group?: DeviceGroup,
): boolean {
  const deviceGroup = group || getDeviceGroup(device);
  return (
    deviceGroup === "shutter" ||
    deviceGroup === "venetian" ||
    deviceGroup === "window"
  );
}
