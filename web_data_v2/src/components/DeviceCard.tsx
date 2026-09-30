import { useCallback, useEffect, useState } from "preact/hooks";
import { Device } from "../models/Types";
import useI18n from "../hooks/useI18n";
import { useDeviceModal } from "../hooks/useDeviceModal";
import { BlindPane } from "./BlindPane";
import { deviceHasPosition } from "../utils/deviceUtils";
import { useToast } from "../hooks/useToast";
import { ToastType } from "./ToastProvider";
import { useOtaKey } from "../hooks/api/useOtaKey";
import { getFavoritePosition, postDeviceAction } from "../utils/RemoteApi.ts";

interface DeviceCardProps {
  device: Device;
}

export function DeviceCard({ device }: DeviceCardProps) {
  const { t } = useI18n();
  const { open } = useDeviceModal();
  const showToast = useToast();
  const otaKey = useOtaKey();
  const hasPos = deviceHasPosition(device);
  const [blindTarget, setBlindTarget] = useState<number | null>(null);
  const favoritePosition = getFavoritePosition(device.id);

  useEffect(() => {
    setBlindTarget(null);
  }, [device.position]);

  const sendAction = useCallback(
    async (action: string, value?: unknown) => {
      const key = otaKey.data?.key;
      if (!key) {
        throw new Error("OTA key not ready yet.");
      }

      const result = await postDeviceAction(device.id, action, key, value);
      if (result.success === false) {
        throw new Error(result.message || "Action failed");
      }
      return result;
    },
    [device.id, otaKey.data?.key],
  );

  const triggerAction = useCallback(
    async (action: string, value?: unknown, target?: number | null) => {
      if (target !== undefined) {
        setBlindTarget(target);
      }

      try {
        await sendAction(action, value);
      } catch (error) {
        if (target !== undefined) setBlindTarget(null);
        showToast(
          error instanceof Error ? error.message : "Action failed",
          ToastType.ERROR,
        );
      }
    },
    [sendAction, showToast],
  );

  const handleFavorite = useCallback(() => {
    if (favoritePosition === null) {
      showToast(
        t("popup.no_favorite_set") ||
          "No favorite set — use Edit to set one.",
        ToastType.INFO,
      );
      return;
    }

    void triggerAction("position", favoritePosition);
  }, [favoritePosition, showToast, t, triggerAction]);

  const handlePositionChange = useCallback(
    async (newPosition: number) => {
      try {
        await sendAction("position", newPosition);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Action failed",
          ToastType.ERROR,
        );
        throw error;
      }
    },
    [sendAction, showToast],
  );

  return (
    <li
      key={device.id}
      className={`device ${device.inactive ? "inactive" : ""} ${device.is_stopped ? "" : "moving"} ${device.position_estimated ? "estimating" : ""}`}
      data-id={device.id}
    >
      <div className="warn-dot" />
      <div className="moving-dot" />

      <div className="card-top">
        <div>
          <div className="card-name">{device.name}</div>
          <div className="card-meta">
            <span className="card-badge">
              {(device.type_name || "").toLowerCase()}
            </span>
            <span
              className={`card-badge ${device.protocol === "1w" ? "badge-1w" : "badge-2w"}`}
            >
              {device.protocol === "1w" ? "1W" : "2W"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn menu"
          aria-label="Edit"
          onClick={() => open(device)}
        >
          ⋯
        </button>
      </div>

      {device.inactive ? (
        <span className="device-status-only">
          {t ? t("badge.inactive") : "inactive"}
        </span>
      ) : (
        <>
          {hasPos ? (
            <BlindPane
              device={device}
              targetPosition={blindTarget}
              onPositionChange={handlePositionChange}
            />
          ) : (
            <div className="card-spacer" />
          )}

          <div className="card-btn-row">
            <button
              type="button"
              className="card-btn"
              onClick={() => {
                void triggerAction("open", undefined, 0);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="card-btn"
              onClick={() => {
                void triggerAction("stop", undefined, null);
              }}
            >
              ■
            </button>
            <button
              type="button"
              className="card-btn"
              onClick={() => {
                void triggerAction("close", undefined, 100);
              }}
            >
              ↓
            </button>
            <button
              type="button"
              className="card-btn card-fav"
              aria-label="Favorite"
              title={
                favoritePosition !== null
                  ? `Favorite: ${favoritePosition}%`
                  : "No favorite set — use Edit to set one."
              }
              data-fav-device={device.id}
              onClick={handleFavorite}
            >
              ★
            </button>
          </div>
        </>
      )}
    </li>
  );
}
