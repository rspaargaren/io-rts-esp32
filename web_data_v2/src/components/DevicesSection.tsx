import { DeviceCard } from "./DeviceCard.tsx";
import { Device } from "../models/Types.ts";
import { useEffect, useState } from "preact/hooks";
import useI18n from "../hooks/useI18n.tsx";
import { usePairingWizard } from "./Modals/PairingWizard.tsx";

interface DevicesSectionProps {
  devices?: Device[];
}

export function DevicesSection({ devices }: DevicesSectionProps) {
  const [devicesState, setDevices] = useState<Device[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const { t } = useI18n();
  const pairingWizard = usePairingWizard();

  useEffect(() => {
    if (!devices) return;

    const active = devices.filter((d) => !d.inactive);
    const inactive = devices.filter((d) => d.inactive);

    const ordered = [...active, ...inactive];
    setDevices(ordered);
    setActiveCount(active.length);
  }, [devices]);

  const countText = `${activeCount} ${t ? t("nav.devices") : "devices"}`;

  return (
    <>
      <div className="view-header">
        <h2 className="view-title" data-i18n="nav.devices">
          Devices
        </h2>

        <span
          style={{
            fontSize: "11px",
            color: "var(--text3)",
            marginRight: "auto",
            paddingLeft: "8px",
          }}
        >
          {!devices ? "Loading…" : countText}
        </span>

        <button
          className="view-add-btn"
          title="Pair new device"
          onClick={() => pairingWizard.open()}
        >
          +
        </button>
      </div>

      <ul id="device-list">
        {!devicesState ? (
          <li
            style={{
              padding: "20px",
              color: "var(--text3)",
              textAlign: "center",
              gridColumn: "1 / -1",
            }}
          >
            {t ? t("popup.loading") : "Loading…"}
          </li>
        ) : devicesState.length === 0 ? (
          <li
            style={{
              padding: "20px",
              color: "var(--text3)",
              textAlign: "center",
              gridColumn: "1 / -1",
            }}
          >
            {t ? t("list.no_devices_available") : "No devices available."}
          </li>
        ) : (
          devicesState.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))
        )}
      </ul>
    </>
  );
}