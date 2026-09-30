import { useCallback, useEffect, useState } from "preact/hooks";
import useI18n from "../../hooks/useI18n";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, MANUFACTURERS, postAction } from "./shared";

export function BrandRow({ device, setDeviceState }: DeviceRowProps) {
  const [mfrSelect, setMfrSelect] = useState(device.manufacturer_id);
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  useEffect(() => {
    setMfrSelect(device.manufacturer_id);
  }, [device.manufacturer_id]);

  const handleSaveManufacturer = useCallback(async () => {
    const v = parseInt(String(mfrSelect), 10);
    try {
      const r = await postAction(
        device.id,
        "setManufacturer",
        otaData.data?.key as string,
        v,
      );
      if (r.success) {
        setDeviceState((prev) => ({ ...prev, manufacturer_id: v }));
        showToast("Brand saved.", ToastType.SUCCESS);
      } else {
        showToast(r.message || "Failed.", ToastType.ERROR);
      }
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, mfrSelect, otaData.data?.key, setDeviceState, showToast]);

  return (
    <DeviceRow label="Brand" subLabel="Manufacturer of the device.">
      <select
        class="s-input"
        style="font-size: 12px; padding: 4px 8px;"
        value={mfrSelect}
        onChange={(e) => setMfrSelect(parseInt(e.currentTarget.value, 10))}
      >
        {MANUFACTURERS.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
      <button type="button" class="s-btn primary" onClick={handleSaveManufacturer}>
        {t("button.save") || "Save"}
      </button>
    </DeviceRow>
  );
}

