import useI18n from "../../hooks/useI18n";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps } from "./shared";

export function PositionRow({ device }: DeviceRowProps) {
  const { t } = useI18n();

  return (
    <DeviceRow label={t("popup.device_position") || "Position"}>
      <span style="font-size: 13px; color: var(--text2); font-family: var(--mono);">
        {device.position >= 0
          ? `${device.position}% — ${t("label.pos_open") || "Open"}`
          : t("popup.type_unknown") || "Unknown"}
      </span>
    </DeviceRow>
  );
}

