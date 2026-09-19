import { AccordionHead } from "../AccordionHead";
import { useEffect, useState } from "preact/hooks";
import { JSX } from "preact";
import { useFallBackConfig } from "../../hooks/api/useFallBackConfig";
import { Checkbox } from "../Checkbox";

export function FallbackApSettings(): JSX.Element {
  const api = useFallBackConfig();

  const [formValues, setFormValues] = useState({
    enabled: false,
    retries_boot: 0,
    retries_running: 0,
    ap_timeout_s: 0,
    ap_ssid: "",
    ap_running: false,
    connected: false,
  });

  useEffect(() => {
    if (api.loaded && api.data) {
      setFormValues({
        enabled: api.data.enabled,
        retries_boot: api.data.retries_boot,
        retries_running: api.data.retries_running,
        ap_timeout_s: api.data.ap_timeout_s,
        ap_ssid: api.data.ap_ssid,
        ap_running: api.data.ap_running,
        connected: api.data.connected,
      });
    }
  }, [api.loaded, api.data]);

  const handleFieldChange = (
    field: keyof typeof formValues,
    value: string | boolean | number,
  ) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  return (
    <form
      class="acc-row"
      data-help="fallback-ap"
      onSubmit={(e) => {
        e.preventDefault();

        fetch("/api/wifi/fallback", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enabled: formValues.enabled,
            retries_boot: formValues.retries_boot,
            retries_running: formValues.retries_running,
            ap_timeout_s: formValues.ap_timeout_s,
            ap_ssid: formValues.ap_ssid,
          }),
        }).then((r) => {
          // TODO handle save status
        });
      }}
    >
      <AccordionHead
        title="Fallback AP"
        titleI18n="settings.row.fallback-ap"
        helpLabel="Help for fallback-ap"
        helpKey={"fallback-ap"}
        summary={<span class="acc-sum-val">{formValues.ap_ssid}</span>}
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span
            style="font-size:12px;color:var(--text2);"
            data-i18n="label.enable-fallback-ap"
          >
            Enable fallback hotspot
          </span>
          <Checkbox
            name={"enabled"}
            checked={formValues.enabled}
            ariaLabel="Enable fallback hotspot"
          />
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:2">
            <label class={"label-title"} data-i18n="label.hotspot-name">
              Hotspot name (SSID)
            </label>
            <input
              type="text"
              name="ap_ssid"
              value={formValues.ap_ssid}
              onInput={(e) =>
                handleFieldChange(
                  "ap_ssid",
                  (e.currentTarget as HTMLInputElement).value,
                )
              }
              class="s-input"
              maxLength={32}
              placeholder="io-rts-setup"
              style="margin-top:4px;"
            />
          </div>
          <div style="flex:1">
            <label class={"label-title"} data-i18n="label.timeout-s">
              Timeout (s)
            </label>
            <input
              type="number"
              name="ap_timeout_s"
              value={formValues.ap_timeout_s}
              onInput={(e) =>
                handleFieldChange(
                  "ap_timeout_s",
                  Number((e.currentTarget as HTMLInputElement).value),
                )
              }
              class="s-input"
              min={0}
              max={3600}
              placeholder="600"
              style="margin-top:4px;"
            />
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1">
            <label class={"label-title"} data-i18n="label.retries-boot">
              Retries (boot)
            </label>
            <input
              type="number"
              name="retries_boot"
              value={formValues.retries_boot}
              onInput={(e) =>
                handleFieldChange(
                  "retries_boot",
                  Number((e.currentTarget as HTMLInputElement).value),
                )
              }
              class="s-input"
              min={1}
              max={20}
              placeholder="3"
              style="margin-top:4px;"
            />
          </div>
          <div style="flex:1">
            <label class={"label-title"} data-i18n="label.retries-running">
              Retries (running)
            </label>
            <input
              type="number"
              name="retries_running"
              value={formValues.retries_running}
              onInput={(e) =>
                handleFieldChange(
                  "retries_running",
                  Number((e.currentTarget as HTMLInputElement).value),
                )
              }
              class="s-input"
              min={1}
              max={20}
              placeholder="3"
              style="margin-top:4px;"
            />
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1">
            <label class={"label-title"} data-i18n="label.hotspot-password">
              Hotspot password (min 8 chars, blank = open)
            </label>
            <input
              type="password"
              name="password"
              class="s-input"
              placeholder="Blank = clear password"
              style="margin-top:4px;"
            />
          </div>
          <div style="flex:1">
            <label class={"label-title"} data-i18n="label.confirm-password">
              Confirm password
            </label>
            <input
              type="password"
              name="password_confirm"
              class="s-input"
              placeholder="Confirm"
              style="margin-top:4px;"
            />
          </div>
        </div>
        <div class="field-status"></div>
        <button
          class="s-btn primary"
          type="submit"
          data-i18n="button.save-fallback-ap"
        >
          Save Fallback AP
        </button>
      </AccordionHead>
    </form>
  );
}
