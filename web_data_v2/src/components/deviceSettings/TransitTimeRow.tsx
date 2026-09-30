import { useCallback, useEffect, useState } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function TransitTimeRow({ device, setDeviceState, onClose }: DeviceRowProps) {
  const [transitInput, setTransitInput] = useState(
    device.transit_time_ms > 0 ? Math.round(device.transit_time_ms / 1000) : 0,
  );
  const [transitCalibrating, setTransitCalibrating] = useState(false);
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  useEffect(() => {
    setTransitInput(
      device.transit_time_ms > 0 ? Math.round(device.transit_time_ms / 1000) : 0,
    );
  }, [device.transit_time_ms]);

  const handleSaveTransitTime = useCallback(async () => {
    const v = parseInt(String(transitInput), 10);
    if (isNaN(v) || v < 1 || v > 300) {
      showToast("Enter 1–300 seconds.", ToastType.ERROR);
      return;
    }
    try {
      const r = await postAction(
        device.id,
        "setTransitTime",
        otaData.data?.key as string,
        v,
      );
      if (!r.success) {
        showToast(r.message || "Save failed.", ToastType.ERROR);
        return;
      }
      setDeviceState((prev) => ({ ...prev, transit_time_ms: v * 1000 }));
      showToast(
        t("popup.transit_saved") || "Transition time saved.",
        ToastType.SUCCESS,
      );
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, otaData.data?.key, setDeviceState, showToast, t, transitInput]);

  const handleCalibrate = useCallback(async () => {
    if (device.protocol === "1w") {
      setTransitCalibrating(true);
      return;
    }

    setTransitCalibrating(true);
    try {
      const r = await postAction(device.id, "calibrate", otaData.data?.key as string);
      if (!r.success) {
        showToast(r.message || "Calibration failed.", ToastType.ERROR);
      } else {
        showToast("Calibration started.", ToastType.INFO);
      }
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    } finally {
      setTransitCalibrating(false);
    }
  }, [device.id, device.protocol, otaData.data?.key, showToast]);

  return (
    <DeviceRow
      label={t("popup.transit_time") || "Transition time"}
      subLabel={`${transitInput || 10} s`}
    >
      <span style="font-size: 13px; color: var(--text2); margin-right: 8px; display: none;" />
      <input
        type="number"
        min="1"
        max="300"
        value={transitInput || ""}
        onInput={(e) => setTransitInput(parseInt(e.currentTarget.value, 10))}
        class="s-input"
        style="width: 64px;"
        placeholder="s"
      />
      <button type="button" class="s-btn primary" onClick={handleSaveTransitTime}>
        {t("button.save") || "Save"}
      </button>
      <button
        type="button"
        class="s-btn"
        onClick={handleCalibrate}
        disabled={transitCalibrating}
      >
        {transitCalibrating
          ? "Calibrating…"
          : t("popup.transit_calibrate") || "Calibrate"}
      </button>
      <button
        type="button"
        class="s-btn"
        style="display: none;"
        onClick={onClose}
      >
        {t("popup.transit_cancel") || "Cancel"}
      </button>
    </DeviceRow>
  );
}

