import { ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { Device } from "../models/Types";
import { DeviceModal } from "../components/Modals/DeviceModal";

interface DeviceModalApi {
  isOpen: boolean;
  selectedDevice: Device | null;
  open: (device: Device) => void;
  close: () => void;
}

const DeviceModalContext = createContext<DeviceModalApi | null>(null);

interface DeviceModalProviderProps {
  children?: ComponentChildren;
}

export function useDeviceModal(): DeviceModalApi {
  const context = useContext(DeviceModalContext);

  if (!context) {
    throw new Error("useDeviceModal must be used inside <DeviceModalProvider>");
  }

  return context;
}

export function DeviceModalProvider({ children }: DeviceModalProviderProps) {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const open = useCallback((device: Device) => {
    setSelectedDevice(device);
  }, []);

  const close = useCallback(() => {
    setSelectedDevice(null);

  }, []);

  const value = useMemo(
    () => ({
      isOpen: selectedDevice !== null,
      selectedDevice,
      open,
      close,
    }),
    [close, open, selectedDevice],
  );

  return (
    <DeviceModalContext.Provider value={value}>
      {children}
      {selectedDevice ? (
        <DeviceModal device={selectedDevice} onClose={close} />
      ) : null}
    </DeviceModalContext.Provider>
  );
}
