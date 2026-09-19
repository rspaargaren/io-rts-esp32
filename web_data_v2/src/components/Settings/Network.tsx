import { AccordionHead } from "../AccordionHead";
import { useState } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useNetworkConfig } from "../../hooks/api/useNetworkConfig";
import { Checkbox } from "../Checkbox";

export function NetworkSettings() {
  const otaData = useOtaKey();

  const api = useNetworkConfig();

  const [dhcpEnabled] = useState(api.data ? api.data.dhcp : true);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());

        fetch("/api/network/config", {
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
      <div class="acc-row" data-help="network">
        <AccordionHead
          title="Network"
          titleI18n="settings.row.network"
          helpLabel="Help for network"
          helpKey={"network"}
          summary={
            <div class="acc-summary">
              <span class="acc-sum-val">
                {api.data ? api.data.hostname : undefined}
              </span>
            </div>
          }
        >
          <div style="display:flex;gap:6px;align-items:flex-end;">
            <div style="flex:2">
              <label class={"label-title"} data-i18n="label.hostname">
                Hostname
              </label>
              <input
                type="text"
                value={api.data ? api.data.hostname : undefined}
                class="s-input"
                placeholder="io-rts-esp32"
                maxLength={32}
                style="margin-top:4px;"
              />
            </div>
            <div style="flex:1;display:flex;align-items:center;gap:8px;padding-bottom:2px;">
              <span
                style="font-size:12px;color:var(--text2);"
                data-i18n="label.dhcp"
              >
                DHCP
              </span>
              <Checkbox checked={dhcpEnabled} />
            </div>
          </div>
          <div style="flex-direction:column;gap:6px;display:flex;">
            <div style="display:flex;gap:6px;">
              <div style="flex:2">
                <label class={"label-title"} data-i18n="label.ip-address">
                  IP Address
                </label>
                <input
                  type="text"
                  value={api.data ? api.data.ip : undefined}
                  disabled={dhcpEnabled}
                  class="s-input"
                  placeholder="192.168.1.100"
                  style="margin-top:4px;"
                />
              </div>
              <div style="flex:1">
                <label class={"label-title"} data-i18n="label.subnet-mask">
                  Subnet mask
                </label>
                <input
                  type="text"
                  value={api.data ? api.data.mask : undefined}
                  disabled={dhcpEnabled}
                  class="s-input"
                  placeholder="255.255.255.0"
                  style="margin-top:4px;"
                />
              </div>
            </div>
            <div style="display:flex;gap:6px;">
              <div style="flex:1">
                <label class={"label-title"} data-i18n="label.gateway">
                  Gateway
                </label>
                <input
                  type="text"
                  disabled={dhcpEnabled}
                  class="s-input"
                  placeholder="192.168.1.1"
                  style="margin-top:4px;"
                  value={api.data ? api.data.gateway : undefined}
                />
              </div>
              <div style="flex:1">
                <label class={"label-title"} data-i18n="label.dns">
                  DNS
                </label>
                <input
                  type="text"
                  class="s-input"
                  disabled={dhcpEnabled}
                  placeholder="8.8.8.8"
                  style="margin-top:4px;"
                  value={api.data ? api.data.dns1 : undefined}
                />
              </div>
            </div>
            <div>
              <label class={"label-title"} data-i18n="label.sntp-server">
                SNTP server
              </label>
              <input
                type="text"
                disabled={dhcpEnabled}
                class="s-input"
                placeholder="pool.ntp.org"
                style="margin-top:4px;"
                value={api.data ? api.data.sntp : undefined}
              />
            </div>
          </div>
          <button
            type={"submit"}
            class="s-btn primary"
            data-i18n="button.save-network"
          >
            Save Network
          </button>
          <p class="warning-notive" data-i18n="label.restart-notice">
            ⚠ Device will restart after saving.
          </p>
        </AccordionHead>
      </div>
    </form>
  );
}
