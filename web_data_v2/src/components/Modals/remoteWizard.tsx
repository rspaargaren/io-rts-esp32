import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cancelCaptureRequest,
  deleteRemote,
  linkRemote,
  REMOTE_ID_RE,
  startCaptureRequest,
  unlinkRemote,
} from "../../utils/RemoteApi.ts";
import useI18n from "../../hooks/useI18n";
import { Device, Remote } from "../../models/Types";
import { useOtaKey } from "../../hooks/api/useOtaKey";

export type WizardMode = "add" | "edit";
type Step = "choose" | "capture" | "manual" | "devices";

const CAPTURE_SECONDS = 30;

export interface OpenWizardOptions {
  mode?: WizardMode;
  remoteId?: string;
  linkedDevices?: string[];
}

export interface RemoteWizardApi {
  open: (options?: OpenWizardOptions) => void;
  close: () => void;
  /** Call when the backend reports a remote frame during capture. */
  onRemoteSeen: (remoteId: string) => void;
  /** Call when the backend reports the capture window expired. */
  onCaptureTimeout: () => void;
}

const RemoteWizardContext = createContext<RemoteWizardApi | null>(null);

export function useRemoteWizard(): RemoteWizardApi {
  const ctx = useContext(RemoteWizardContext);
  if (!ctx)
    throw new Error(
      "useRemoteWizard must be used inside <RemoteWizardProvider>",
    );
  return ctx;
}

export interface RemoteWizardProviderProps {
  devices: Device[];
  remotes: Remote[];
  onSaved?: () => void | Promise<void>;
  children?: React.ReactNode;
}

export function RemoteWizardProvider({
  devices,
  remotes,
  onSaved,
  children,
}: RemoteWizardProviderProps) {
  const otaData = useOtaKey();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<WizardMode>("add");
  const [step, setStep] = useState<Step>("choose");
  const [remoteId, setRemoteId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [manualInput, setManualInput] = useState("");
  const [manualError, setManualError] = useState("");
  const [devicesError, setDevicesError] = useState("");
  const [devicesErrorMuted, setDevicesErrorMuted] = useState(false);
  const [saving, setSaving] = useState(false);

  const { t } = useI18n();

  const [, setCaptureActive] = useState(false);
  const [, setCaptureStatus] = useState<{
    text: string;
    tone: "" | "red" | "green";
  }>({ text: "", tone: "" });
  const [, setSeconds] = useState(CAPTURE_SECONDS);
  const [, setShowRetry] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureActiveRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelCapture = useCallback(() => {
    captureActiveRef.current = false;
    setCaptureActive(false);
    clearTimer();
    cancelCaptureRequest(otaData.data?.key as string).catch(() => undefined);
  }, [clearTimer, otaData.data?.key]);

  const startCapture = useCallback(() => {
    setShowRetry(false);
    setSeconds(CAPTURE_SECONDS);
    setCaptureStatus({ text: t("status.press-remote-button"), tone: "" });

    clearTimer();
    captureActiveRef.current = true;
    setCaptureActive(true);

    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearTimer();
          captureActiveRef.current = false;
          setCaptureActive(false);
          setCaptureStatus({
            text: t("status.no-remote-detected"),
            tone: "red",
          });
          setShowRetry(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    startCaptureRequest(otaData.data?.key as string).catch((e: Error) => {
      clearTimer();
      captureActiveRef.current = false;
      setCaptureActive(false);
      setCaptureStatus({
        text: t("status.capture_failed", { message: e.message }),
        tone: "red",
      });
      setShowRetry(true);
    });
  }, [clearTimer]);

  const selectedForDevices = useCallback(
    (linked: string[]) =>
      devices
        .filter((d) => !d.inactive)
        .filter(
          (d) => linked.indexOf(d.id) !== -1 || linked.indexOf(d.name) !== -1,
        )
        .map((d) => d.id),
    [devices],
  );

  const goToDeviceStep = useCallback(
    (id: string) => {
      setRemoteId(id);
      const existing = remotes.find((r) => r.id === id);
      if (existing) {
        setMode("edit");
        setSelectedIds(selectedForDevices(existing.devices || []));
        setDevicesError(t("status.remote_already_linked"));
        setDevicesErrorMuted(true);
      } else {
        setSelectedIds([]);
        setDevicesError("");
        setDevicesErrorMuted(false);
      }
      setStep("devices");
    },
    [remotes, selectedForDevices],
  );

  const open = useCallback(
    (options?: OpenWizardOptions) => {
      const nextMode = options?.mode || "add";
      setMode(nextMode);
      setRemoteId(options?.remoteId || "");
      setDevicesError("");
      setDevicesErrorMuted(false);
      setManualInput("");
      setManualError("");
      setSaving(false);
      setShowRetry(false);
      setCaptureStatus({ text: "", tone: "" });

      if (nextMode === "edit") {
        setSelectedIds(selectedForDevices(options?.linkedDevices || []));
        setStep("devices");
      } else {
        setSelectedIds([]);
        setStep("choose");
      }

      setIsOpen(true);
    },
    [selectedForDevices],
  );

  const close = useCallback(() => {
    cancelCapture();
    setRemoteId("");
    setIsOpen(false);
  }, [cancelCapture]);

  const onRemoteSeen = useCallback(
    (id: string) => {
      if (!captureActiveRef.current) return;
      cancelCapture();
      setCaptureStatus({
        text: t("status.remote_detected", { id }),
        tone: "green",
      });
      setTimeout(() => goToDeviceStep(id), 800);
    },
    [cancelCapture, goToDeviceStep],
  );

  const onCaptureTimeout = useCallback(() => {
    if (!captureActiveRef.current) return;
    cancelCapture();
    setCaptureStatus({ text: t("status.no-remote-detected"), tone: "red" });
    setShowRetry(true);
  }, [cancelCapture]);

  useEffect(() => clearTimer, [clearTimer]);

  const toggleDevice = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.indexOf(id) === -1 ? prev.concat(id) : prev.filter((x) => x !== id),
    );
  }, []);

  const submitManualId = useCallback(() => {
    const value = manualInput.trim().toUpperCase();
    if (!REMOTE_ID_RE.test(value)) {
      setManualError(t("status.remote_id_invalid"));
      return;
    }
    setManualError("");
    goToDeviceStep(value);
  }, [manualInput, goToDeviceStep]);

  const save = useCallback(async () => {
    setDevicesError("");
    setDevicesErrorMuted(false);

    if (!selectedIds.length) {
      setDevicesError(t("status.select-at-least-one-device"));
      return;
    }

    setSaving(true);
    try {
      if (mode === "add") {
        for (const deviceId of selectedIds) {
          const result = await linkRemote(
            remoteId,
            deviceId,
            otaData.data?.key as string,
          );
          if (!result.success)
            throw new Error(result.message || "Link failed for " + deviceId);
        }
        // showToast(t("toast.remote_added", { id: remoteId }), "success");
      } else {
        await unlinkRemote(remoteId, otaData.data?.key as string);
        const failed: string[] = [];
        for (const deviceId of selectedIds) {
          try {
            await linkRemote(remoteId, deviceId, otaData.data?.key as string);
          } catch {
            failed.push(deviceId);
          }
        }
        if (failed.length) {
          setDevicesError(
            t("status.link_partial_fail", { ids: failed.join(", ") }),
          );
          setSaving(false);
          await onSaved?.();
          return;
        }
        // showToast(t("toast.remote_updated", { id: remoteId }), "success");
      }
      setSaving(false);
      close();
      await onSaved?.();
    } catch (e) {
      setDevicesError("Error: " + (e as Error).message);
      setSaving(false);
    }
  }, [mode, remoteId, selectedIds, close, onSaved]);

  const remove = useCallback(async () => {
    if (!confirm(t("confirm.delete_remote", { id: remoteId }))) return;
    try {
      await deleteRemote(remoteId, otaData.data?.key as string);
      // showToast(t("toast.remote_removed"), "success");
      close();
      await onSaved?.();
    } catch (e) {
      setDevicesError("Error: " + (e as Error).message);
    }
  }, [remoteId, close, onSaved]);

  const api = useMemo<RemoteWizardApi>(
    () => ({ open, close, onRemoteSeen, onCaptureTimeout }),
    [open, close, onRemoteSeen, onCaptureTimeout],
  );

  return (
    <RemoteWizardContext.Provider value={api}>
      {children}
      {isOpen && (
        <div
          className="key-modal open"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="modal-content">
            <div class="key-modal-inner arm-inner">
              <h3>
                {mode === "edit"
                  ? t("popup.edit_remote")
                  : t("popup.add_remote")}
              </h3>

              {step === "choose" && (
                <div className="arm-step">
                  <p class="key-modal-warning-text" style="margin-bottom:16px;">
                    How do you want to add the remote?
                  </p>
                  <button
                    className="btn-danger-confirm"
                    onClick={() => {
                      setStep("capture");
                      startCapture();
                    }}
                  >
                    {t("button.capture_remote")}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setManualInput("");
                      setManualError("");
                      setStep("manual");
                    }}
                  >
                    {t("button.enter_manually")}
                  </button>
                  <button className="btn-ghost" onClick={close}>
                    {t("button.cancel")}
                  </button>
                </div>
              )}

               {step === "capture" && (
                 <div class="arm-step">
                   <div class="arm-capture-row">
                     <p class="key-modal-warning-text">
                      Press any button on the remote…
                    </p>
                    <span id="arm-countdown" class="arm-countdown">
                      30s
                    </span>
                  </div>
                  <div class="key-modal-actions">
                    <button
                      id="arm-capture-cancel"
                      class="btn-ghost"
                      onClick={close}
                    >
                      {t("button.cancel")}
                    </button>
                    <button id="arm-skip-btn" class="btn-ghost">
                      Enter manually
                    </button>
                    <button
                      id="arm-retry-btn"
                      class="btn-ghost"
                      style="display:none;"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}

              {step === "manual" && (
                <div className="arm-step">
                  <label class="key-modal-label">
                    Remote ID (6 hex characters):
                  </label>
                  <input
                    value={manualInput}
                    class="key-modal-input"
                    placeholder="A1B2C3"
                    autocomplete="off"
                    style="font-family:var(--mono);text-transform:uppercase;letter-spacing:0.1em;"
                    maxLength={6}
                    onChange={(e) => setManualInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitManualId();
                    }}
                  />
                  {manualError && (
                    <p
                      id="arm-manual-error"
                      class="key-modal-status"
                      style="color:var(--red);min-height:18px;"
                    >
                      {manualError}
                    </p>
                  )}

                  <div class="key-modal-actions">
                    <button
                      id="arm-manual-cancel"
                      class="btn-ghost"
                      onClick={close}
                    >
                      {t("button.cancel")}
                    </button>
                    <button
                      id="arm-manual-back"
                      class="btn-ghost"
                      onClick={() => setStep("choose")}
                    >
                      {t("button.back")}
                    </button>
                    <button
                      id="arm-manual-next"
                      class="btn-danger-confirm"
                      onClick={submitManualId}
                    >
                      {t("button.next")}
                    </button>
                  </div>
                </div>
              )}

              {step === "devices" && (
                <div className="arm-step">
                  {remoteId && (
                    <div className="arm-remote-id">
                      {t("status.remote_label", { id: remoteId })}
                    </div>
                  )}
                  <div id="arm-device-list">
                    {devices.filter((d) => !d.inactive).length === 0
                      ? t("status.no_devices_paired")
                      : devices
                          .filter((d) => !d.inactive)
                          .map((device) => (
                            <label className="arm-device-item" key={device.id}>
                              <input
                                type="checkbox"
                                className="arm-device-item"
                                value={device.id}
                                checked={selectedIds.indexOf(device.id) !== -1}
                                onChange={() => toggleDevice(device.id)}
                              />
                              <span>{device.name}</span>
                            </label>
                          ))}
                  </div>
                  {devicesError && (
                    <div
                      style={{
                        color: devicesErrorMuted ? "var(--text3)" : undefined,
                      }}
                    >
                      {devicesError}
                    </div>
                  )}
                  {mode === "edit" ? (
                    <button class="btn-ghost arm-delete-btn" onClick={remove}>
                      {t("button.delete")}
                    </button>
                  ) : (
                    <button
                      className="btn bg"
                      onClick={() => setStep("choose")}
                    >
                      {t("button.back")}
                    </button>
                  )}
                  <button
                    class="btn-danger-confirm"
                    disabled={saving}
                    onClick={save}
                  >
                    {t("button.save")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </RemoteWizardContext.Provider>
  );
}
