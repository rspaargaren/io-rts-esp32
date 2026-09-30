import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function DeactivateRow({ device, onClose }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handleDeactivate = useCallback(async () => {
    if (
      !confirm(
        (t("confirm.deactivate_device") || 'Deactivate "{name}"?').replace(
          "{name}",
          device.name,
        ) +
          "\n" +
          (t("popup.deactivate_warning") ||
            "The device will be kept as inactive and can be re-activated later."),
      )
    ) {
      return;
    }
    try {
      const r = await postAction(
        device.id,
        "deactivateDevice",
        otaData.data?.key as string,
      );
      if (!r.success) {
        showToast(r.message || "Deactivate failed.", ToastType.ERROR);
        return;
      }
      showToast(
        t("popup.device_deactivated") || "Device deactivated.",
        ToastType.INFO,
      );
      onClose?.();
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, device.name, onClose, otaData.data?.key, showToast, t]);

  if (device.inactive) {
    return null;
  }

  return (
    <DeviceRow
      label={t("button.deactivate") || "Deactivate"}
      subLabel={
        t("popup.deactivate_desc") ||
        "Keeps device in list but removes controls. Reversible."
      }
    >
      <button type="button" class="s-btn danger" onClick={handleDeactivate}>
        {t("button.deactivate") || "Deactivate"}
      </button>
    </DeviceRow>
  );
}

