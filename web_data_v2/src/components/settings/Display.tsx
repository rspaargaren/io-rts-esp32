import { useEffect, useState } from "preact/hooks";
import { AccordionHead } from "../AccordionHead";
import { Checkbox } from "../Checkbox";
import { ToastType } from "../ToastProvider";
import { useToast } from "../../hooks/useToast";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import { saveDisplayEnabled } from "../../utils/RemoteApi";
import useI18n from "../../hooks/useI18n.tsx";

export function DisplaySettings() {
  const otaData = useOtaKey();
  const showToast = useToast();
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/settings", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const data = (await response.json()) as { display_enabled?: unknown };
        if (typeof data.display_enabled !== "boolean") {
          throw new Error("Display setting missing from device response");
        }
        if (!cancelled) setEnabled(data.display_enabled);
      } catch {
        if (!cancelled) {
          showToast(t("toast.display-load-failed"), ToastType.ERROR);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);

  const changeEnabled = async (nextEnabled: boolean) => {
    if (enabled === undefined || saving) return;
    if (!otaData.data?.key) {
      showToast(t("toast.display-save-failed"), ToastType.ERROR);
      return;
    }

    const previous = enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    try {
      await saveDisplayEnabled(otaData.data.key, nextEnabled);
      showToast(t("toast.display-saved"), ToastType.SUCCESS);
    } catch {
      setEnabled(previous);
      showToast(t("toast.display-save-failed"), ToastType.ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="acc-row">
      <AccordionHead
        title="Device Display"
        titleI18n="settings.row.display"
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:12px;color:var(--text2);" data-i18n="label.enable-display">
            Enable device display
          </span>
          {enabled === undefined ? (
            <span class="row-value">…</span>
          ) : (
            <Checkbox
              name="display_enabled"
              checked={enabled}
              disabled={saving}
              ariaLabel={t("label.enable-display")}
              onChange={(checked) => void changeEnabled(checked)}
            />
          )}
        </div>
        {saving && <span class="field-status">{t("toast.display-saving")}</span>}
      </AccordionHead>
    </div>
  );
}
