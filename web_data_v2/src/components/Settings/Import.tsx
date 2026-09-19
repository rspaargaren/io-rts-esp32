import { AccordionHead } from "../AccordionHead";

//TODO: Implement import functionality
export function ImportSettings() {
  return (
    <div class="acc-row">
      <AccordionHead
        title="Import iohomecontrol"
        summary={
          <span class="acc-sum-hint">Devices &amp; remotes from backup</span>
        }
      >
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">
          Import 1W devices and remotes from an iohomecontrol backup file.
          Existing devices with the same ID are overwritten.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
          <button class="s-btn">Import Devices JSON</button>
          <input type="file" accept=".json" style="display:none" />
          <span class="field-status"></span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button class="s-btn">Import Remotes JSON</button>
          <input type="file" accept=".json" style="display:none" />
          <span class="field-status"></span>
        </div>
        <div style="margin-top:10px;display:none;"></div>
      </AccordionHead>
    </div>
  );
}
