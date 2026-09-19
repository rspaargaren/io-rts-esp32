
import { useOtaKey } from "../../hooks/api/useOtaKey";
import useI18n from "../../hooks/useI18n";

export function RebootSettings() {
  const otaData = useOtaKey();
  const {t} = useI18n()

  return (
    <div class="settings-row">
      <span
        class="row-label danger"
        data-i18n="settings.row.reboot"
        style="cursor:pointer;"
        onClick={() => {

          if(confirm(t("confirm.reboot"))) {
            fetch("/api/reboot", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-OTA-Key": otaData.data?.key || "",
              },
            }).then(() => {
              // TODO handle response
            });
            }
          }}
      >
        Reboot Device
      </span>
      <div class="row-right">
        <span class="row-chevron">›</span>
      </div>
    </div>
  );
}
