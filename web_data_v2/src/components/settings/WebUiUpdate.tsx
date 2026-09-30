import { AccordionHead } from "../AccordionHead";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useState } from "preact/hooks";

export function WebUIUpdateSettings() {
  const otaData = useOtaKey();
  const [status, setStatus] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();

        const fd = new FormData(e.currentTarget);
        const file = fd.get("firmware");

        if (!(file instanceof File) || file.size === 0) {
          setStatus("Select a firmware file first.");
          return;
        }

        setStatus("Uploading Web UI...");

        try {
          const response = await fetch("/api/ota/web", {
            method: "POST",
            body: file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-OTA-Key": otaData.data?.key || "",
            },
          });

          if (!response.ok) {
            setStatus(`Upload failed (${response.status}).`);
            return;
          }

          setStatus("Web UI uploaded. The device is rebooting.");
        } catch {
          setStatus(
            "Upload failed. Check the device connection and try again.",
          );
        }
      }}
    >
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
              name="firmware"
              accept=".bin"
              class="s-input"
              style="padding:5px 10px;margin-top:4px;"
            />
          </div>
          <button
            type="submit"
            class="s-btn primary"
            data-i18n="button.upload-web-ui"
          >
            Upload Web UI
          </button>
          <span id="ota-status" class="field-status">
            {status}
          </span>
        </AccordionHead>
      </div>
    </form>
  );
}
