import { InfoResponse } from "../../models/Types";

export function FirmwareSettings({ data }: { data: InfoResponse | undefined }) {
  return (
    <div class="settings-row">
      <span class="row-label" data-i18n="settings.row.firmware">
        Firmware
      </span>
      <div class="row-right">
        <span class="row-value">
          {data?.version} · {data?.compile_date}
        </span>
      </div>
    </div>
  );
}
