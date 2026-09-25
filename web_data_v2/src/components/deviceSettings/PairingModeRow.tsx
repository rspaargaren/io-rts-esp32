import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function PairingModeRow({ device }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handlePairingMode = useCallback(async () => {
    try {
      const r = await postAction(device.id, "wink1w", otaData.data?.key as string);
      if (r.success) {
        showToast(
          "Device entering pairing mode. Now pair your other remote.",
          ToastType.SUCCESS,
        );
      } else {
        showToast(r.message || "Failed.", ToastType.ERROR);
      }
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, otaData.data?.key, showToast]);

  return (
    <DeviceRow
      label="Put in pairing mode"
      subLabel="Put the device in pairing acceptance mode so other remotes can pair with it."
    >
      <button type="button" class="s-btn" onClick={handlePairingMode}>
        {t("button.pair") || "Put in pairing mode"}
      </button>
    </DeviceRow>
  );
}

