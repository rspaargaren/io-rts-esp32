import { InfoResponse } from "../../models/Types";

export function WebUISettings({ data }: { data: InfoResponse | undefined }) {
  return (
    <div class="settings-row">
      <span class="row-label" data-i18n="settings.row.web-ui">
        Web UI
      </span>
      <div class="row-right">
        <span class="row-value">{data?.web_version}</span>
      </div>
    </div>
  );
}
