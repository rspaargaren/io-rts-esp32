export const LANGUAGE_STORAGE_KEY = "io-homecontrol-language";
export const FAVORITE_POSITION_STORAGE_PREFIX = "fav_pos_";
export const REMOTE_ID_RE = /^[0-9A-F]{6}$/;

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

export const PAIRING_DEVICE_TYPES = [
  [2, "Roller shutter"],
  [3, "Awning"],
  [10, "Blind"],
  [0, "All types"],
] as const;

export const PAIRING_MANUFACTURERS = [
  [2, "Somfy (default)"],
  [1, "Velux"],
] as const;
