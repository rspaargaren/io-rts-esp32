import { useCallback, useEffect, useState } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DEVICE_TYPES, DeviceRowProps, postAction } from "./shared";

export function DeviceTypeRow({ device, setDeviceState, onClose }: DeviceRowProps) {
  const [typeSelect, setTypeSelect] = useState(device.type);
  const showToast = useToast();
  const otaData = useOtaKey();

  useEffect(() => {
    setTypeSelect(device.type);
  }, [device.type]);

  const handleSaveDeviceType = useCallback(async () => {
    const v = parseInt(String(typeSelect), 10);
    try {
      const r = await postAction(device.id, "setDeviceType", otaData.data?.key as string, v);
      if (r.success) {
        setDeviceState((prev) => ({ ...prev, type: v }));
        showToast("Device type saved.", ToastType.SUCCESS);
        onClose?.();
      } else {
        showToast(r.message || "Failed.", ToastType.ERROR);
      }
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, onClose, otaData.data?.key, setDeviceState, showToast, typeSelect]);

  return (
    <DeviceRow label="Device type" subLabel="Controls which buttons appear in the UI.">
      <select
        class="s-input"
        style="font-size: 12px; padding: 4px 8px;"
        value={typeSelect}
        onChange={(e) => setTypeSelect(parseInt(e.currentTarget.value, 10))}
      >
        {DEVICE_TYPES.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
      <button type="button" class="s-btn primary" onClick={handleSaveDeviceType}>
        Save
      </button>
    </DeviceRow>
  );
}

