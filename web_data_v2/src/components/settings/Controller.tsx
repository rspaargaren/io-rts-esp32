import { AccordionHead } from "../AccordionHead";
import { Checkbox } from "../Checkbox";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useIOConfig } from "../../hooks/api/useIOConfig";
import { ToastType } from "../ToastProvider";
import { useToast } from "../../hooks/useToast";

export function ControllerSettings() {
  const otaData = useOtaKey();
  const api = useIOConfig();
  const showToast = useToast();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());

        fetch("/api/io/config", {
          method: "POST",
          body: JSON.stringify(data),
          headers: {
            "Content-Type": "application/json",
            "X-OTA-Key": otaData.data?.key || "",
          },
        })
          .then(() => {
            showToast("toast.controller-saved", ToastType.SUCCESS);
          })
          .catch(() => {
            showToast("toast.error-saving-controller", ToastType.ERROR);
          });
      }}
    >
      <div class="acc-row" data-help="controller">
        <AccordionHead
          title="Controller Identity"
          titleI18n="settings.row.controller"
          helpLabel="Help for controller"
          helpKey={"controller"}
          summary={
            <div class="acc-summary">
              <span class="acc-sum-val" id="acc-ctrl-val">
                {api.data?.node_id}
              </span>
            </div>
          }
        >
          <div style="display:flex;gap:6px;align-items:center;">
            <div style="flex:1;">
              <label class={"label-title"} data-i18n="label.node-address">
                Node Address (3 bytes hex)
              </label>
              <input
                type="text"
                name={"node_id"}
                value={api.data?.node_id || ""}
                class="s-input"
                placeholder="A1B1C3"
                maxLength={6}
                style="font-family:var(--mono);text-transform:uppercase;margin-top:4px;"
              />
            </div>
            <div style="flex:1;">
              <label class={"label-title"} data-i18n="label.tx-power">
                TX Power (0–20 dBm)
              </label>
              <input
                name={"tx_power"}
                value={api.data?.tx_power || 17}
                type="number"
                class="s-input"
                min={0}
                max={20}
                placeholder="17"
                style="margin-top:4px;"
              />
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span
              style="font-size:12px;color:var(--text2);"
              data-i18n="label.passive-mode"
            >
              Passive mode (listen only)
            </span>
            <Checkbox
              name={"passive_mode"}
              checked={api.data?.passive_mode || false}
            />
          </div>
          <button class="s-btn primary" data-i18n="button.save-controller">
            Save Controller Settings
          </button>
        </AccordionHead>
      </div>
    </form>
  );
}
