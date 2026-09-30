import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function DeleteRow({ device, onClose }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handleDelete = useCallback(async () => {
    const deleteWarning =
      device.protocol === "1w"
        ? t("popup.delete_warning_1w") ||
          "Removes from this controller only. Unpair first to free the remote slot on the device."
        : t("popup.delete_warning") ||
          "Permanent removal. Cannot be undone — requires factory reset to re-pair.";

    if (
      !confirm(
        (t("confirm.delete_device") || 'Permanently delete "{name}"?').replace(
          "{name}",
          device.name,
        ) +
          "\n" +
          deleteWarning,
      )
    ) {
      return;
    }

    try {
      const doDelete = async () => {
        const r = await postAction(
          device.id,
          "deleteDevice",
          otaData.data?.key as string,
        );
        if (!r.success) {
          showToast(r.message || "Delete failed.", ToastType.ERROR);
          return;
        }
        showToast(
          t("popup.device_deleted") || "Device permanently deleted.",
          ToastType.INFO,
        );
        onClose?.();
      };

      if (!device.inactive) {
        await postAction(
          device.id,
          "deactivateDevice",
          otaData.data?.key as string,
        );
      }
      await doDelete();
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, device.inactive, device.name, device.protocol, onClose, otaData.data?.key, showToast, t]);

  return (
    <DeviceRow
      label={t("popup.device_delete_label") || "Delete permanently"}
      subLabel={
        device.protocol === "1w"
          ? t("popup.delete_desc_1w") ||
            "Removes from this controller. Unpair first to clear the slot from the device."
          : t("popup.delete_warning") ||
            "Cannot be undone. Requires factory reset to re-pair."
      }
    >
      <button type="button" class="s-btn danger" onClick={handleDelete}>
        {t("button.delete") || "Delete"}
      </button>
    </DeviceRow>
  );
}

