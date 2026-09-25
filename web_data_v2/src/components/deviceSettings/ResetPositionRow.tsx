import { useCallback } from "preact/hooks";
import useI18n from "../../hooks/useI18n";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, postAction } from "./shared";

export function ResetPositionRow({ device, setDeviceState }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  const handleResetPosition = useCallback(
    async (value: 0 | 100) => {
      try {
        const r = await postAction(
          device.id,
          "resetPosition1w",
          otaData.data?.key as string,
          value,
        );
        if (r.success) {
          setDeviceState((prev) => ({ ...prev, position: value }));
          showToast(
            `Position reset to ${value === 0 ? "open" : "closed"}.`,
            ToastType.SUCCESS,
          );
        } else {
          showToast(r.message || "Failed.", ToastType.ERROR);
        }
      } catch (e) {
        showToast((e as Error).message, ToastType.ERROR);
      }
    },
    [device.id, otaData.data?.key, setDeviceState, showToast],
  );

  return (
    <DeviceRow label="Reset position" subLabel="Force estimated position to a known state.">
      <button type="button" class="s-btn" onClick={() => handleResetPosition(0)}>
        0% — {t("label.pos_open") || "Open"}
      </button>
      <button type="button" class="s-btn" onClick={() => handleResetPosition(100)}>
        100% — {t("label.pos_closed") || "Closed"}
      </button>
    </DeviceRow>
  );
}

