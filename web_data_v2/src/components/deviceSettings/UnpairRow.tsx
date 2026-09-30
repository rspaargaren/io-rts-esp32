import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function UnpairRow({ device }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handleUnpair = useCallback(async () => {
    try {
      const r = await postAction(
        device.id,
        "sendremove1w",
        otaData.data?.key as string,
      );
      if (!r.success) {
        showToast(r.message || "Failed.", ToastType.ERROR);
        return;
      }
      showToast("REMOVE sent — device should confirm.", ToastType.INFO);
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, otaData.data?.key, showToast]);

  if (device.protocol !== "1w" || device.inactive) {
    return null;
  }

  return (
    <DeviceRow
      label={t("button.unpair") || "Unpair"}
      subLabel="Send REMOVE frame to the device, then confirm it responded before deleting from storage."
    >
      <button type="button" class="s-btn danger" onClick={handleUnpair}>
        {t("button.unpair") || "Unpair device"}
      </button>
    </DeviceRow>
  );
}

