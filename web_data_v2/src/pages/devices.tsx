import { Remotes } from "../components/Remotes";
import { RemoteWizardProvider } from "../components/Modals/remoteWizard";
import { DeviceModalProvider } from "../hooks/useDeviceModal";
import { PairingWizardProvider } from "../components/Modals/PairingWizard.tsx";
import { useDevices } from "../hooks/api/useDevices.tsx";
import { useRemotes } from "../hooks/api/useRemotes.tsx";
import { DevicesSection } from "../components/DevicesSection.tsx";
import { useWebSocket, WebSocketLogMessage } from "../hooks/useWebSocket.tsx";
import { useEffect, useState } from "preact/hooks";

export function Devices() {
  const deviceApi = useDevices();
  const remotesApi = useRemotes();

  const [devices, setDevices] = useState(deviceApi.data ?? []);

  useEffect(() => {
    setDevices(deviceApi.data ?? []);
  }, [deviceApi.data]);

  useWebSocket<WebSocketLogMessage>({
    helloMessage: '{"type":"hello"}',
    onOpen: () => {
      console.log("WS connected");
    },
    onClose: () => {
      console.log("WS closed");
    },
    onMessage: (data) => {
      if (data.type === "position" && data.id) {
        setDevices((prev) =>
          prev.map((device) => {
            if (device.id !== data.id) return device;

            return {
              ...device,
              position:
                typeof data.position === "number"
                  ? data.position
                  : device.position,
              is_stopped:
                typeof data.is_stopped === "boolean"
                  ? data.is_stopped
                  : device.is_stopped,
              position_estimated:
                typeof data.estimated === "boolean"
                  ? data.estimated
                  : device.position_estimated,
            };
          }),
        );
      }
    },
  });

  return (
    <DeviceModalProvider>
      <PairingWizardProvider
        onDeviceAdded={(deviceId, deviceName) => {
          console.log(`Device ${deviceName} added`);
          // Refresh device list, etc.
        }}
        onDevicePairingStatusUpdated={() => {
          // Refresh pairing status
        }}
      >
        <section className="view active">
          <DevicesSection devices={devices} />

          <RemoteWizardProvider
            remotes={remotesApi.data ?? []}
            devices={devices}
          >
            <Remotes remotesApi={remotesApi} />
          </RemoteWizardProvider>
        </section>
      </PairingWizardProvider>
    </DeviceModalProvider>
  );
}
