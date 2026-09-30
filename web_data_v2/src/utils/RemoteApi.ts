import { FAVORITE_POSITION_STORAGE_PREFIX } from "../models/Constants";
import type { ActionResult } from "../models/Types.ts";

async function postJson<T>(
  url: string,
  otaKey: string,
  payload: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-OTA-Key": otaKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: unknown }).message ?? response.statusText)
        : response.statusText;

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return data;
}

export function startCaptureRequest(otaKey: string): Promise<unknown> {
  return postJson("/api/remote/capture/start", otaKey, {});
}

export function cancelCaptureRequest(otaKey: string): Promise<unknown> {
  return postJson("/api/remote/capture/cancel", otaKey, {});
}

export function linkRemote(
  remoteId: string,
  deviceId: string,
  otaKey: string,
): Promise<ActionResult> {
  return postJson<ActionResult>("/api/action", otaKey, {
    action: "linkRemote",
    remoteId,
    deviceId,
  });
}

export function unlinkRemote(
  remoteId: string,
  otaKey: string,
): Promise<ActionResult> {
  return postJson<ActionResult>("/api/action", otaKey, {
    action: "unlinkRemote",
    remoteId,
  });
}

export function deleteRemote(
  remoteId: string,
  otaKey: string,
): Promise<ActionResult> {
  return postJson<ActionResult>("/api/action", otaKey, {
    action: "deleteRemote",
    remoteId,
  });
}

export function getFavoritePosition(deviceId: string): number | null {
  const value = localStorage.getItem(
    FAVORITE_POSITION_STORAGE_PREFIX + deviceId,
  );
  return value !== null ? parseInt(value, 10) : null;
}

export function setFavoritePosition(deviceId: string, position: number): void {
  localStorage.setItem(
    FAVORITE_POSITION_STORAGE_PREFIX + deviceId,
    String(position),
  );
}

export async function postDeviceAction(
  deviceId: string,
  action: string,
  otaKey: string,
  value?: unknown,
): Promise<ActionResult> {
  const payload: { deviceId: string; action: string; value?: unknown } = {
    deviceId,
    action,
  };

  if (value !== undefined) payload.value = value;

  const response = await fetch("/api/action", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-OTA-Key": otaKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as ActionResult) : {};

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: unknown }).message ?? response.statusText)
        : response.statusText;

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return data;
}
