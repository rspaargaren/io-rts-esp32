import useI18n from "../../hooks/useI18n";
import { DeactivateRow } from "./DeactivateRow";
import { DeleteRow } from "./DeleteRow";
import { DeviceRowProps } from "./shared";
import { UnpairRow } from "./UnpairRow";

export function DangerZone(props: DeviceRowProps) {
  const { t } = useI18n();

  return (
    <div class="dev-danger-zone">
      <div class="dev-danger-label">
        {t("popup.device_danger_zone") || "Danger zone"}
      </div>
      <DeactivateRow {...props} />
      <UnpairRow {...props} />
      <DeleteRow {...props} />
    </div>
  );
}

