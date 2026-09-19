import { AccordionHead } from "../AccordionHead";
import { useOtaKey } from "../../hooks/api/useOtaKey";

export function OtaKeySettings() {

  const otaKeyApi = useOtaKey();

  return (
    <form
      class="acc-row"
      data-help="wifi"
      onSubmit={(e) => {
        e.preventDefault();

        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());

        fetch("/api/ota/key", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-OTA-Key": otaKeyApi.data?.key ?? "",
          },
          body: JSON.stringify(data),
        }).then((r) => {
          // TODO handle Response status: restarting
        });
      }}
    >
    <div class="acc-row" data-help="ota-key">
      <AccordionHead
        title="OTA Key"
        summary={
          <span class="acc-sum-val" id="acc-otakey-val">
            ••••
          </span>
        }
        titleI18n="settings.row.ota-key"
        helpLabel="Help for ota-key"
        helpKey="ota-key"
      >
        <div style="display:flex;gap:6px;align-items:center;">
          <input
            type="text"
            name={"key"}
            class="s-input key-display"
            value={otaKeyApi.data?.key ?? ""}
            style="flex:1;font-size:11px;"
          />
          <button type={"submit"} class="s-btn">
            Save
          </button>
        </div>
        <p class="warning-notive" data-i18n="label.ota-key-notice">
          ⚠ Changing the OTA key invalidates any scripts using the current key..
        </p>
      </AccordionHead>
    </div></form>
  );
}
