import { AccordionHead } from "../AccordionHead";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useSyslogConfig } from "../../hooks/api/useSyslogConfig";
import { Checkbox } from "../Checkbox";
import { ToastType } from "../ToastProvider";
import { useToast } from "../../hooks/useToast";

export function SyslogSettings() {
  const otaData = useOtaKey();
  const api = useSyslogConfig();
  const showToast = useToast();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault(); // Prevent the default form submission

        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());

        fetch("/api/syslog", {
          method: "POST",
          body: JSON.stringify(data),
          headers: {
            "Content-Type": "application/json",
            "X-OTA-Key": otaData.data?.key || "",
          },
        })
          .then(() => {
            showToast("toast.syslog-saved", ToastType.SUCCESS);
          })
          .catch(() => {
            showToast("toast.error-saving-syslog", ToastType.ERROR);
          });
      }}
    >
      <div class="acc-row" data-help="syslog">
        <AccordionHead
          title="Syslog"
          titleI18n="settings.row.syslog"
          helpLabel="Help for syslog"
          helpKey={"syslog"}
          summary={
            <>
              <span class="acc-sum-val">{api.data?.server || "Off"}</span>
              <span class="row-status" />
            </>
          }
        >
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span
              style="font-size:12px;color:var(--text2);"
              data-i18n="label.enable-syslog"
            >
              Enable syslog
            </span>
            <Checkbox />
          </div>
          <div style="display:flex;gap:6px;">
            <div style="flex:2;">
              <label class={"label-title"} data-i18n="label.server-address">
                Server address
              </label>
              <input
                value={api.data?.server}
                type="text"
                class="s-input"
                placeholder="192.168.1.x"
                style="margin-top:4px;"
              />
            </div>
            <div style="flex:1;">
              <label class={"label-title"} data-i18n="label.port">
                Port
              </label>
              <input
                value={api.data?.port}
                type="text"
                class="s-input"
                placeholder="514"
                style="margin-top:4px;"
              />
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <div style="flex:1">
              <label class={"label-title"} data-i18n="label.facility">
                Facility
              </label>
              <input
                type="number"
                value={api.data?.facility}
                class="s-input"
                min={0}
                max={23}
                placeholder="1"
                style="margin-top:4px;"
              />
            </div>
            <div style="flex:1">
              <label class={"label-title"} data-i18n="label.min-level">
                Min level
              </label>
              <select
                class="s-select"
                style="margin-top:4px;"
                value={api.data?.min_level}
              >
                <option value="3">Error</option>
                <option value="4">Warning</option>
                <option value="6">Info</option>
                <option value="7">Debug</option>
              </select>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label class={"label-title"} data-i18n="label.device-identifier">
              Device identifier (shown in log)
            </label>
            <input
              type="text"
              class="s-input"
              placeholder="auto-generated"
              maxLength={15}
              value={api.data?.id}
            />
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <label class={"label-title"}>Format</label>
            <select class="s-select" value={api.data?.format}>
              <option value="5424">RFC 5424</option>
              <option value="3164">RFC 3164 (Graylog)</option>
            </select>
          </div>
          <button class="s-btn primary" data-i18n="button.save-syslog">
            Save Syslog
          </button>
        </AccordionHead>
      </div>
    </form>
  );
}
