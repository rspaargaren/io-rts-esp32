import { AccordionHead } from "../AccordionHead";

//TODO: implement IO System Key functionality
export function IoSystemKeySettings() {
  return (
    <div class="acc-row" data-help="io-key">
      <AccordionHead
        title="IO System Key"
        titleI18n="settings.row.io-key"
        helpKey={"io-key"}
        helpLabel="Help for io-key"
        summary={<span class="acc-sum-val">(not set)</span>}
      >
        <div class="sensitive-notice" data-i18n="label.io-key-warning">
          Changing this key makes all paired devices unreachable until reboot.
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <input
            type="password"
            class="s-input key-display"
            placeholder="(not set)"
            readOnly
            style="flex:1;min-width:140px;"
          />
          <button class="s-btn" data-i18n="button.show">
            Show
          </button>
          <button class="s-btn">Edit</button>
          <button class="s-btn">Sniff</button>
          <button class="s-btn">Learn</button>
        </div>
        <span class="field-status" />
      </AccordionHead>
    </div>
  );
}
