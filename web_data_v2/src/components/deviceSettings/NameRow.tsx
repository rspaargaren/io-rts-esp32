import { useCallback, useEffect, useState } from "preact/hooks";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRowProps, postAction } from "./shared";

export function NameRow({ device, setDeviceState, onClose }: DeviceRowProps) {
  const [nameInput, setNameInput] = useState(device.name);
  const showToast = useToast();
  const { t } = useI18n();
  const otaData = useOtaKey();

  useEffect(() => {
    setNameInput(device.name);
  }, [device.name]);

  const handleSaveName = useCallback(async () => {
    const val = nameInput.trim();
    if (!val) {
      showToast(
        t("popup.rename_empty") || "Name cannot be empty.",
        ToastType.ERROR,
      );
      return;
    }
    if (val === device.name) {
      onClose?.();
      return;
    }
    try {
      const r = await postAction(device.id, "rename", otaData.data?.key as string, val);
      if (!r.success) {
        showToast(
          r.message || t("popup.rename_failed") || "Rename failed.",
          ToastType.ERROR,
        );
        return;
      }
      showToast(
        r.message || t("popup.renamed") || "Renamed.",
        ToastType.SUCCESS,
      );
      setDeviceState((prev) => ({ ...prev, name: val }));
      onClose?.();
    } catch (e) {
      showToast((e as Error).message, ToastType.ERROR);
    }
  }, [device.id, device.name, nameInput, onClose, otaData.data?.key, setDeviceState, showToast, t]);

  return (
    <div class="dev-name-row">
      <input
        type="text"
        class="s-input"
        style="flex: 1 1 0%;"
        value={nameInput}
        onInput={(e) => setNameInput(e.currentTarget.value)}
      />
      <button
        type="button"
        class="s-btn primary"
        style="flex-shrink: 0;"
        onClick={handleSaveName}
      >
        {t("button.save") || "Save"}
      </button>
    </div>
  );
}

