export function PairingLogs() {
  const downloadPairingLogs = async () => {
    const response = await fetch("/api/pairing-log");

    if (!response.ok) {
      throw new Error(`Pairing log request failed: ${response.status}`);
    }

    const logText = await response.text();
    const url = URL.createObjectURL(
      new Blob([logText], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = "pairing_logs.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="settings-row">
      <span class="row-label" data-i18n="settings.row.pairing-log">
        Pairing Log
      </span>
      <div class="row-right">
        <button
          type="button"
          class="s-btn"
          id="pairing-log-btn"
          data-i18n="button.download"
          onClick={() => {
            void downloadPairingLogs();
          }}
        >
          Download
        </button>
      </div>
    </div>
  );
}
