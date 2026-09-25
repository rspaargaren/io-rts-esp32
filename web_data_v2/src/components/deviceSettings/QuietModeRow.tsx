import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, getDeviceGroup, postAction } from "./shared";

export function QuietModeRow({ device, setDeviceState }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();
  const hasPos = ["shutter", "venetian", "window", "gate"].includes(
    getDeviceGroup(device),
  );

  const handleQuietToggle = useCallback(async () => {
    const newVal = !device.is_quiet;
    try {
      const r = await postAction(
        device.id,
        "setQuiet",
        otaData.data?.key as string,
        newVal,
      );
      if (!r.success) {
        showToast(r.message || "Quiet mode failed.", ToastType.ERROR);
        return;
      }
      setDeviceState((prev) => ({ ...prev, is_quiet: newVal }));
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, device.is_quiet, otaData.data?.key, setDeviceState, showToast]);

  if (device.inactive || device.protocol === "1w" || !hasPos) {
    return null;
  }

  return (
    <DeviceRow
      label={t("label.quiet_mode") || "Quiet mode"}
      subLabel={t("popup.quiet_desc") || "Slower, quieter motor operation."}
    >
      <div class={`s-toggle${device.is_quiet ? " on" : ""}`} onClick={handleQuietToggle} />
    </DeviceRow>
  );
}

