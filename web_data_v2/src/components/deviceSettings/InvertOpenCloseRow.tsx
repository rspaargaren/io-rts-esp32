import { useCallback } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, getDeviceGroup, postAction } from "./shared";

export function InvertOpenCloseRow({ device, setDeviceState }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();
  const hasFav = ["shutter", "venetian", "window"].includes(getDeviceGroup(device));

  const handleInvertToggle = useCallback(async () => {
    try {
      const r = await postAction(
        device.id,
        "invertOpenClose",
        otaData.data?.key as string,
      );
      if (!r.success) {
        showToast(r.message || "Invert failed.", ToastType.ERROR);
        return;
      }
      const newInverted = !device.is_inverted;
      setDeviceState((prev) => ({ ...prev, is_inverted: newInverted }));
      showToast(t("popup.inverted") || "Direction inverted.", ToastType.SUCCESS);
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, device.is_inverted, otaData.data?.key, setDeviceState, showToast, t]);

  if (device.inactive || device.protocol === "1w" || !hasFav) {
    return null;
  }

  return (
    <DeviceRow
      label={t("label.invert_openclose") || "Invert open/close"}
      subLabel={t("popup.invert_desc") || "Swap which end counts as fully open."}
    >
      <div class={`s-toggle${device.is_inverted ? " on" : ""}`} onClick={handleInvertToggle} />
    </DeviceRow>
  );
}

