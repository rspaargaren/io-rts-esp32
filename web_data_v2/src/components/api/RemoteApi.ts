import { ActionResult } from "../../models/Types";

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

export const REMOTE_ID_RE = /^[0-9A-F]{6}$/;
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
