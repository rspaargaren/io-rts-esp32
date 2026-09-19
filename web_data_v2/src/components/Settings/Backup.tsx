import { AccordionHead } from "../AccordionHead";


//TODO : Implement backup and restore functionality
export function BackupSettings() {
  return (
    <div class="acc-row" data-help="backup">
      <AccordionHead
        title="Backup / Restore"
        titleI18n="settings.row.backup"
        helpLabel="Help for backup"
        helpKey="backup"
        summary={<span class="acc-sum-hint">Export · Import · Reset</span>}
      >
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="s-btn" data-i18n="button.export-backup">
            Export Backup
          </button>
          <button class="s-btn" data-i18n="button.import-backup">
            Import Backup
          </button>
          <input type="file" accept=".json" style="display:none" />
          <button class="s-btn danger" data-i18n="button.factory-reset">
            Factory Reset
          </button>
        </div>
        <span class="field-status"></span>
      </AccordionHead>
    </div>
  );
}
