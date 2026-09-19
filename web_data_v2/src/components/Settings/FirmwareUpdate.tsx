import { AccordionHead } from "../AccordionHead";

//TODO: implement firmware update functionality

export function FirmwareUpdateSettings() {
  return (
    <div class="acc-row">
      <AccordionHead
        title="Firmware Update"
        titleI18n="settings.row.firmware-update"
        summary={<span class="acc-sum-hint">Upload .bin file</span>}
      >
        <div>
          <label class={"label-title"}>
            Firmware file — use <strong>heltec-vX.X.X-firmware.bin</strong> from
            the GitHub release, not full.bin or web.bin
          </label>
          <input
            type="file"
            accept=".bin"
            class="s-input"
            style="padding:5px 10px;margin-top:4px;"
          />
        </div>
        <button class="s-btn primary" data-i18n="button.upload-firmware">
          Upload Firmware
        </button>
        <progress id="ota-progress" max={100} value={0} style="display:none;" />
        <span id="ota-status" class="field-status" />
      </AccordionHead>
    </div>
  );
}
