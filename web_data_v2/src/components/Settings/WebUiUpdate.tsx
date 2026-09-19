import { AccordionHead } from "../AccordionHead";


//TODO: implement web ui update functionality
export function WebUIUpdateSettings() {
  return (
    <div class="acc-row">
      <AccordionHead
        title="Web UI Update"
        titleI18n="settings.row.web-update"
        summary={<span class="acc-sum-hint">Upload .bin file</span>}
      >
        <div>
          <label class={"label-title"} data-i18n="label.web-ui-file">
            Web UI file (.bin)
          </label>
          <input
            type="file"
            accept=".bin"
            class="s-input"
            style="padding:5px 10px;margin-top:4px;"
          />
        </div>
        <button class="s-btn primary" data-i18n="button.upload-web-ui">
          Upload Web UI
        </button>
        <progress
          id="ota-web-progress"
          max={100}
          value={0}
          style="display:none;"
        />
        <span id="ota-web-status" class="field-status" />
      </AccordionHead>
    </div>
  );
}
