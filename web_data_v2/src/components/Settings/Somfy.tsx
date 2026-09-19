import { AccordionHead } from "../AccordionHead";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useSomfyConfig } from "../../hooks/api/useSomfyConfig";

export function SomfySettings() {
  const otaData = useOtaKey();

  const api = useSomfyConfig();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());

        fetch("/api/somfy/credentials", {
          method: "POST",
          body: JSON.stringify(data),
          headers: {
            "Content-Type": "application/json",
            "X-OTA-Key": otaData.data?.key || "",
          },
        }).then(() => {
          // TODO handle response
        });
      }}
    >
      <div class="acc-row" data-help="somfy">
        <AccordionHead
          title="Somfy / Overkiz"
          titleI18n="settings.row.somfy"
          helpKey="somfy"
          helpLabel="Help for somfy"
        >
          <div>
            <label class={"label-title"} data-i18n="label.somfy-email">
              Somfy account email
            </label>
            <input
              type="text"
              name="email"
              value={api.data?.email}
              class="s-input"
              placeholder="your@somfy.com"
              style="margin-top:4px;"
              autocomplete="username"
            />
          </div>
          <div>
            <label class={"label-title"} data-i18n="label.somfy-password">
              Somfy account password
            </label>
            <input
              type="password"
              name="password"
              class="s-input"
              placeholder="••••••••"
              style="margin-top:4px;"
              autocomplete="current-password"
            />
          </div>
          <div style="display:flex;gap:8px;">
            <button class="s-btn primary" data-i18n="button.save-credentials">
              Save credentials
            </button>
            <button
              type="submit"
              class="s-btn"
              data-i18n="button.import-devices-btn"
            >
              Import devices
            </button>
          </div>
          <span style="font-size:11px;color:var(--text3);min-height:16px;" />
        </AccordionHead>
      </div>
    </form>
  );
}
