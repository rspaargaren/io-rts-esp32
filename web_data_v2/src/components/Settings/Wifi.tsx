import { AccordionHead } from "../AccordionHead";
import { useEffect, useState } from "preact/hooks";
import useI18n from "../../hooks/useI18n";
import { JSX } from "preact";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { useWifiConfig } from "../../hooks/api/useWifiConfig";
import { WifiScanResult } from "../../models/Types";
import { useToast } from "../../hooks/useToast.tsx";
import { ToastType } from "../ToastProvider";

export function WifiSettings(): JSX.Element {
  const [scan, setScan] = useState(false);
  const [scanResults, setScanResults] = useState<WifiScanResult[]>([]);

  const wifiData = useWifiConfig();
  const otaData = useOtaKey();
  const { t } = useI18n();
  const showToast = useToast();

  const [formValues, setFormValues] = useState({
    ssid: "",
    password: "",
  });

  useEffect(() => {
    if (wifiData.loaded && wifiData.data) {
      setFormValues((current) => ({
        ...current,
        ssid: wifiData.data?.ssid ?? current.ssid,
      }));
    }
  }, [wifiData.loaded, wifiData.data]);

  const handleFieldChange = (field: "ssid" | "password", value: string) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const scanWifiNetworks = () => {
    setScan(true);
    fetch("/api/wifi/scan", {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-OTA-Key": otaData.data?.key ?? "",
      },
    })
      .then(async (r) => {
        if (r.ok) {
          setScanResults((await r.json()) as WifiScanResult[]);
          setScan(false);
        }
      })
      .catch(() => {
        showToast("toast.wifi-scan-failed", ToastType.ERROR);
        setScan(false);
      });
  };

  const getIcon = (rssi: number) => {
    if (rssi > -55) return "▂▄▆█";
    if (rssi > -70) return "▂▄▆";
    if (rssi > -80) return "▂▄";
    return "▂";
  };

  return (
    <form
      class="acc-row"
      data-help="wifi"
      onSubmit={(e) => {
        e.preventDefault();

        fetch("/api/wifi/config", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-OTA-Key": otaData.data?.key ?? "",
          },
          body: JSON.stringify({
            ssid: formValues.ssid,
            password: formValues.password,
          }),
        })
          .then(() => {
            showToast("toast.wifi-saved-restarting", ToastType.SUCCESS);
          })
          .catch(() => {
            showToast("toast.error-saving-wifi", ToastType.ERROR);
          });
      }}
    >
      <AccordionHead
        title="WiFi"
        titleI18n="settings.row.wifi"
        helpLabel="Help for wifi"
        helpKey={"wifi"}
        summary={
          <>
            <span class="acc-sum-val">{formValues.ssid}</span>
            <span
              class={
                wifiData.loaded && wifiData.data != null
                  ? "success-text row-status"
                  : "error-text row-status"
              }
            >
              {wifiData.loaded && wifiData.data
                ? t("status.wifi.connected")
                : t("status.wifi.not-connected")}
            </span>
          </>
        }
      >
        <div style="display:flex;gap:6px;">
          <div style="flex:1;">
            <label class={"label-title"} data-i18n="label.network-name-ssid">
              Network name (SSID)
            </label>
            <div style="display:flex;gap:6px;margin-top:4px;">
              <input
                type="text"
                name="ssid"
                value={formValues.ssid}
                onInput={(e) =>
                  handleFieldChange(
                    "ssid",
                    (e.currentTarget as HTMLInputElement).value,
                  )
                }
                class="s-input"
                placeholder="Network name"
                maxLength={32}
                style="flex:1;"
              />
              <button
                class="s-btn"
                type="button"
                disabled={scan}
                data-i18n={scan ? "button.scanning" : "button.scan"}
                onClick={() => scanWifiNetworks()}
              />
            </div>
          </div>
        </div>
        {scanResults.length > 0 && (
          <div id="wifi-scan-results" style="display: block;">
            {scanResults.map((result: WifiScanResult) => (
              <div
                class="wifi-scan-row"
                onClick={() => {
                  handleFieldChange("ssid", result.ssid);
                  setScan(false);
                  setScanResults([]);
                }}
              >
                <span>{result.ssid}</span>
                <span class="wifi-scan-signal">
                  {getIcon(result.rssi)} {result.rssi}
                </span>
              </div>
            ))}
          </div>
        )}
        <div>
          <label class={"label-title"} data-i18n="label.password">
            Password
          </label>
          <input
            type="password"
            name="password"
            value={formValues.password}
            onInput={(e) =>
              handleFieldChange(
                "password",
                (e.currentTarget as HTMLInputElement).value,
              )
            }
            class="s-input"
            placeholder="Leave blank to keep current"
            data-i18n-placeholder="label.wifi-password-hint"
            style="margin-top:4px;"
          />
        </div>
        <button
          class="s-btn primary"
          type="submit"
          data-i18n="button.save-wifi"
        >
          Save WiFi
        </button>
        <div class="field-status"></div>
        <p class="restart-notice" data-i18n="label.warning-notive">
          ⚠ Device will restart after saving.
        </p>
      </AccordionHead>
    </form>
  );
}
