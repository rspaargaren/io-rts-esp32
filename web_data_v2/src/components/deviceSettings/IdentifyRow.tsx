import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function IdentifyRow({ device }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handleIdentify = useCallback(async () => {
    try {
      await postAction(device.id, "identify", otaData.data?.key as string);
      showToast(
        t("popup.identifying") || "Identify sent — watch for a brief movement.",
        ToastType.INFO,
      );
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, otaData.data?.key, showToast, t]);

  if (device.inactive || device.protocol === "1w") {
    return null;
  }

  return (
    <DeviceRow
      label={t("button.identify") || "Identify"}
      subLabel={
        t("popup.device_identify_desc") ||
        "Triggers a brief movement to locate the device."
      }
    >
      <button type="button" class="s-btn" onClick={handleIdentify}>
        {t("button.identify") || "Identify"}
      </button>
    </DeviceRow>
  );
}

