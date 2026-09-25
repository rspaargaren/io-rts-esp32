import { useRef, useState } from "preact/hooks";
import { AccordionHead } from "../AccordionHead";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import useI18n from "../../hooks/useI18n";

type BackupResponse = {
  message?: string;
  success?: boolean;
};

export function BackupSettings() {
  const otaData = useOtaKey();
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const setResult = (message: string, ok?: boolean) => {
    setStatus(message);
    setStatusOk(ok);
  };

  const otaHeaders = (): Record<string, string> =>
    otaData.data?.key ? { "X-OTA-Key": otaData.data.key } : {};

  const exportBackup = async () => {
    setBusy(true);
    setResult(t("toast.backup-exporting"));
    try {
      const response = await fetch("/api/backup", { headers: otaHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "io-rts-backup.json";
      link.click();
      URL.revokeObjectURL(link.href);
      setResult(t("toast.backup-exported"), true);
    } catch (error) {
      setResult(
        t("toast.backup-export-failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        false,
      );
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (file: File) => {
    if (!window.confirm(t("confirm.restore-backup"))) return;

    setBusy(true);
    setResult(t("toast.backup-importing"));
    try {
      const response = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...otaHeaders() },
        body: await file.text(),
      });
      const data = (await response.json()) as BackupResponse;
      if (!response.ok)
        throw new Error(data.message || `HTTP ${response.status}`);
      setResult(data.message || t("toast.backup-importing"), data.success);
    } catch (error) {
      setResult(
        t("toast.backup-restore-failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        false,
      );
    } finally {
      setBusy(false);
    }
  };

  const factoryReset = async () => {
    if (!window.confirm(t("confirm.factory-reset-1"))) return;
    if (!window.confirm(t("confirm.factory-reset-2"))) return;

    setBusy(true);
    setResult("…");
    try {
      const response = await fetch("/api/factory-reset", {
        method: "POST",
        headers: otaHeaders(),
      });
      const data = (await response.json()) as BackupResponse;
      if (!response.ok)
        throw new Error(data.message || `HTTP ${response.status}`);
      setResult(
        data.message || t("toast.factory-reset-rebooting"),
        data.success,
      );
    } catch (error) {
      setResult(
        error instanceof Error
          ? error.message
          : "Factory reset request failed.",
        false,
      );
    } finally {
      setBusy(false);
    }
  };

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
          <button
            type="button"
            class="s-btn"
            data-i18n="button.export-backup"
            disabled={busy}
            onClick={exportBackup}
          >
            Export Backup
          </button>
          <button
            type="button"
            class="s-btn"
            data-i18n="button.import-backup"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Import Backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            style="display:none"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importBackup(file);
            }}
          />
          <button
            type="button"
            class="s-btn danger"
            data-i18n="button.factory-reset"
            disabled={busy}
            onClick={() => void factoryReset()}
          >
            Factory Reset
          </button>
        </div>
        <span
          class={
            statusOk === true
              ? "field-status success-text"
              : statusOk === false
                ? "field-status error-text"
                : "field-status"
          }
        >
          {status}
        </span>
      </AccordionHead>
    </div>
  );
}
