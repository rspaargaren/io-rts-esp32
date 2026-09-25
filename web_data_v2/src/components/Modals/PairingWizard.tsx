import { createContext, type ComponentChildren } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import { postAction } from "../deviceSettings/shared";

export interface PairingWizardApi {
  open: () => void;
  close: () => void;
  onPairingActive: () => void;
  onDeviceAdded: (deviceId: string, deviceName: string) => void;
  onPairFailed: (data?: { status?: string; message?: string }) => void;
  onRemoteSeen: (remoteId: string) => void;
  onCaptureTimeout: () => void;
}

const PairingWizardContext = createContext<PairingWizardApi | null>(null);

export function usePairingWizard(): PairingWizardApi {
  const ctx = useContext(PairingWizardContext);
  if (!ctx)
    throw new Error(
      "usePairingWizard must be used inside <PairingWizardProvider>",
    );
  return ctx;
}

interface PairingWizardProviderProps {
  onDeviceAdded?: (
    deviceId: string,
    deviceName: string,
  ) => void | Promise<void>;
  onDevicePairingStatusUpdated?: () => void | Promise<void>;
  children?: ComponentChildren;
}

type Step =
  | "choose"
  | "2w-discovery"
  | "1w-wizard"
  | "1w-confirm"
  | "add-by-address"
  | "remote-capture"
  | "remote-capture-confirm";

const DEVICE_TYPES = [
  [2, "Roller shutter"],
  [3, "Awning"],
  [10, "Blind"],
  [0, "All types"],
] as const;

const MANUFACTURERS = [
  [2, "Somfy (default)"],
  [1, "Velux"],
] as const;

export function PairingWizardProvider({
  onDeviceAdded: onDeviceAddedProp,
  onDevicePairingStatusUpdated,
  children,
}: PairingWizardProviderProps) {
  const { t } = useI18n();
  const otaKey = useOtaKey();
  const showToast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [status, setStatus] = useState("");
  const [statusHtml, setStatusHtml] = useState("");

  // 2W Discovery
  const [countdown, setCountdown] = useState(120);

  // 1W Wizard
  const [deviceName1w, setDeviceName1w] = useState("");
  const [deviceType1w, setDeviceType1w] = useState(2);
  const [manufacturer1w, setManufacturer1w] = useState(2);

  // 1W Confirm
  const [pairedDeviceId, setPairedDeviceId] = useState("");
  const [pairedDeviceName, setPairedDeviceName] = useState("");

  // Add by address
  const [addressInput, setAddressInput] = useState("");
  const [nameInputAddress, setNameInputAddress] = useState("");
  const [protocolAddress, setProtocolAddress] = useState("2W");
  const [deviceTypeAddress, setDeviceTypeAddress] = useState(0);
  const [isLowPowerAddress, setIsLowPowerAddress] = useState(false);

  // Remote capture
  const [remoteId, setRemoteId] = useState("");
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureActiveRef = useRef(false);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setStep("choose");
    setStatus("");
    setStatusHtml("");
    setDeviceName1w("");
    setDeviceType1w(2);
    setManufacturer1w(2);
    setPairedDeviceId("");
    setPairedDeviceName("");
    setAddressInput("");
    setNameInputAddress("");
    setProtocolAddress("2W");
    setDeviceTypeAddress(0);
    setIsLowPowerAddress(false);
    setRemoteId("");
    setPendingDeviceId(null);
    clearCountdownTimer();
    captureActiveRef.current = false;
  }, [clearCountdownTimer]);

  const open = useCallback(() => {
    setIsOpen(true);
    setStep("choose");
    setStatus("");
    setStatusHtml("");
    setDeviceName1w("");
    setDeviceType1w(2);
    setManufacturer1w(2);
    setPairedDeviceId("");
    setPairedDeviceName("");
    setAddressInput("");
    setNameInputAddress("");
    setProtocolAddress("2W");
    setDeviceTypeAddress(0);
    setIsLowPowerAddress(false);
    setRemoteId("");
    setPendingDeviceId(null);
  }, []);

  // Format time as "Xm Ys"
  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (m > 0 ? `${m}m ` : "") + `${s}s`;
  };

  // 2W Discovery
  const start2wDiscovery = useCallback(() => {
    setStep("2w-discovery");
    setCountdown(120);
    setStatusHtml("");
    clearCountdownTimer();

    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearCountdownTimer();
          captureActiveRef.current = false;
          return 0;
        }
        return next;
      });
    }, 1000);

    fetch("/api/pair/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch((e) => {
      clearCountdownTimer();
      setStatusHtml(
        `${t("popup.pair_failed") || "Pairing request failed."} ${e.message}`,
      );
    });
  }, [t, clearCountdownTimer]);

  // 1W Wizard
  const send1wPairingFrames = useCallback(() => {
    if (!deviceName1w.trim()) {
      showToast(
        t("popup.name_required") || "Name cannot be empty",
        ToastType.ERROR,
      );
      return;
    }

    setStatus("Sending pairing frames…");

    postAction("", "pair1w", otaKey.data?.key || "", {
      name: deviceName1w.trim(),
      deviceType: deviceType1w,
      manufacturer: manufacturer1w,
    })
      .then((data: { success?: boolean; message?: string; deviceId?: string }) => {
        if (data.success && data.deviceId) {
          setPairedDeviceId(data.deviceId);
          setPairedDeviceName(deviceName1w);
          setStep("1w-confirm");
          setStatus(
            "Pairing frames sent.\n\nDid the device confirm? (brief jog movement or LED blink)",
          );
        } else {
          setStatus("Pairing failed — is the device in pairing mode?");
        }
      })
      .catch((e) => {
        setStatus(`Error: ${e.message || "Unknown error"}`);
      });
  }, [deviceName1w, deviceType1w, manufacturer1w, showToast, t, otaKey.data?.key]);

  // 1W Confirm: Resend
  const resend1wPairing = useCallback(() => {
    setStatus("Resending…");
    postAction(pairedDeviceId, "sendpair1w", otaKey.data?.key || "")
      .then(() => {
        setStatus(
          "Pairing frames sent.\n\nDid the device confirm? (brief jog movement or LED blink)",
        );
      })
      .catch(() => {
        setStatus(
          "Pairing frames sent.\n\nDid the device confirm? (brief jog movement or LED blink)",
        );
      });
  }, [pairedDeviceId, otaKey.data?.key]);

  // 1W Confirm: Accept
  const confirm1wPairing = useCallback(() => {
    setStatus(`✓ Paired: ${pairedDeviceName}`);
    showToast(`Device ${pairedDeviceName} paired`, ToastType.SUCCESS);
    onDeviceAddedProp?.(pairedDeviceId, pairedDeviceName);
    setTimeout(() => close(), 1000);
  }, [pairedDeviceId, pairedDeviceName, showToast, onDeviceAddedProp, close]);

  // 1W Confirm: Cancel
  const cancel1wPairing = useCallback(() => {
    postAction(pairedDeviceId, "deactivateDevice", otaKey.data?.key || "")
      .then(() =>
        postAction(pairedDeviceId, "deleteDevice", otaKey.data?.key || ""),
      )
      .catch(() => {})
      .finally(() => close());
  }, [pairedDeviceId, close, otaKey.data?.key]);

  // Add by address
  const addDeviceByAddress = useCallback(() => {
    const addr = addressInput.trim().toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(addr)) {
      showToast("Must be exactly 6 hex characters (0–9, A–F)", ToastType.ERROR);
      return;
    }

    setStatus("Adding device…");

    postAction("", "addDevice", otaKey.data?.key || "", {
      id: addr,
      name: nameInputAddress.trim(),
      device_type: parseInt(deviceTypeAddress.toString(), 10),
      protocol: protocolAddress,
      is_low_power: isLowPowerAddress,
    })
      .then((data) => {
        if (data.success) {
          setStatus(`✓ Device ${addr} added.`);
          showToast(`Device ${addr} added`, ToastType.SUCCESS);
          onDeviceAddedProp?.(addr, nameInputAddress.trim() || addr);
          setTimeout(() => close(), 1000);
        } else {
          setStatus(`Failed: ${data.message || "Unknown error"}`);
        }
      })
      .catch((e) => {
        setStatus(`Error: ${e.message || "Unknown error"}`);
      });
  }, [
    addressInput,
    nameInputAddress,
    deviceTypeAddress,
    protocolAddress,
    isLowPowerAddress,
    showToast,
    onDeviceAddedProp,
    close,
    otaKey.data?.key,
  ]);

  // WebSocket callbacks
  const onPairingActive = useCallback(() => {
    // Server liveness heartbeat
  }, []);

  const onDeviceAdded = useCallback(
    (deviceId: string, deviceName: string) => {
      if (!isOpen) return;
      clearCountdownTimer();
      setStatus(
        `${t("popup.pair_step3_success") || "Device paired: {name}"}`.replace(
          "{name}",
          deviceName,
        ),
      );
      showToast(`Device ${deviceName} paired`, ToastType.SUCCESS);
      onDeviceAddedProp?.(deviceId, deviceName);
      onDevicePairingStatusUpdated?.();
      setTimeout(() => close(), 1000);
    },
    [
      isOpen,
      clearCountdownTimer,
      t,
      showToast,
      onDeviceAddedProp,
      onDevicePairingStatusUpdated,
      close,
    ],
  );

  const onPairFailed = useCallback(
    (data?: { status?: string; message?: string }) => {
      if (!isOpen) return;
      clearCountdownTimer();

      if (data?.status === "key_mismatch") {
        setStatusHtml(
          `<span style="color:var(--red)">${
            data.message ||
            t("popup.pair_key_mismatch") ||
            "Device found but has a different system key. Factory reset the device and try again."
          }</span>`,
        );
      } else {
        setStatus(t("popup.pair_timeout") || "No device found.");
      }
    },
    [isOpen, clearCountdownTimer, t],
  );

  const onRemoteSeen = useCallback(
    (capturedRemoteId: string) => {
      if (!isOpen || !pendingDeviceId) return;
      setRemoteId(capturedRemoteId);
      setStatus(
        `${t("popup.remote_captured") || "Remote detected: {id}"}`.replace(
          "{id}",
          capturedRemoteId,
        ),
      );
      setStep("remote-capture-confirm");
    },
    [isOpen, pendingDeviceId, t],
  );

  const onCaptureTimeout = useCallback(() => {
    if (!isOpen || !pendingDeviceId) return;
    setStatus(
      t("popup.remote_capture_timeout") ||
        "No remote detected within 30 seconds.",
    );
  }, [isOpen, pendingDeviceId, t]);

  // Link remote to device
  const linkRemoteToDevice = useCallback(() => {
    if (!pendingDeviceId || !remoteId) return;

    fetch("/api/remote/capture/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});

    postAction(pendingDeviceId, "linkRemote", otaKey.data?.key || "", remoteId)
      .then(() => {
        showToast(`Remote ${remoteId} linked`, ToastType.SUCCESS);
        onDevicePairingStatusUpdated?.();
        close();
      })
      .catch((e) => {
        showToast(`Link failed: ${e.message}`, ToastType.ERROR);
      });
  }, [
    pendingDeviceId,
    remoteId,
    showToast,
    onDevicePairingStatusUpdated,
    close,
    otaKey.data?.key,
  ]);

  // Update countdown display
  useEffect(() => {
    if (step === "2w-discovery") {
      const display = formatTime(countdown);
      setStatusHtml(
        `${t("popup.pair_step2_scanning") || "Scanning up to 2 minutes..."} <strong>${display}</strong>`,
      );
    }
  }, [countdown, step, t]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      clearCountdownTimer();
    };
  }, [clearCountdownTimer]);

  const api = useMemo<PairingWizardApi>(
    () => ({
      open,
      close,
      onPairingActive,
      onDeviceAdded,
      onPairFailed,
      onRemoteSeen,
      onCaptureTimeout,
    }),
    [
      open,
      close,
      onPairingActive,
      onDeviceAdded,
      onPairFailed,
      onRemoteSeen,
      onCaptureTimeout,
    ],
  );

  return (
    <PairingWizardContext.Provider value={api}>
      {children}
      {isOpen && (
        <div
          className="key-modal open"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="modal-content">
            <div className="key-modal-inner">
              <h3>{t("popup.pair_wizard_title") || "Pair Device"}</h3>

              {step === "choose" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "16px",
                    }}
                  >
                    Choose the connection type for this device:
                  </p>

                  {/* 2W Card */}
                  <div
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--separator)",
                      borderRadius: "10px",
                      padding: "12px 14px",
                      marginBottom: "8px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface3)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--blue,#5b9ecf)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface2)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--separator)";
                    }}
                    onClick={start2wDiscovery}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        marginBottom: "4px",
                      }}
                    >
                      2W — Bidirectional (most devices)
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        lineHeight: "1.45",
                      }}
                    >
                      The device reports its real position back to the
                      controller. Supports auto-calibration and accurate
                      position tracking. Required for Somfy RS100 IO, Velux, and
                      similar modern motors.
                    </div>
                  </div>

                  {/* 1W Card */}
                  <div
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--separator)",
                      borderRadius: "10px",
                      padding: "12px 14px",
                      marginBottom: "8px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface3)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--blue,#5b9ecf)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface2)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--separator)";
                    }}
                    onClick={() => {
                      setDeviceName1w("");
                      setDeviceType1w(2);
                      setManufacturer1w(2);
                      setStep("1w-wizard");
                    }}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        marginBottom: "4px",
                      }}
                    >
                      1W — Simplex (TX only)
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        lineHeight: "1.45",
                      }}
                    >
                      Commands are sent only; the device never replies. Position
                      is estimated by a timer — manual calibration needed. Used
                      for older or budget motors that do not send status.
                    </div>
                  </div>

                  {/* Add by Address Card */}
                  <div
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--separator)",
                      borderRadius: "10px",
                      padding: "12px 14px",
                      marginBottom: "8px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface3)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--blue,#5b9ecf)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--surface2)";
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--separator)";
                    }}
                    onClick={() => {
                      setAddressInput("");
                      setNameInputAddress("");
                      setProtocolAddress("2W");
                      setDeviceTypeAddress(0);
                      setIsLowPowerAddress(false);
                      setStep("add-by-address");
                    }}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        marginBottom: "4px",
                      }}
                    >
                      Add by address
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        lineHeight: "1.45",
                      }}
                    >
                      Device already has the system key — enter its address
                      directly. Use when re-adding a known device after a
                      controller reset. No radio pairing needed.
                    </div>
                  </div>

                  <div
                    style={{ display: "flex", gap: "8px", marginTop: "16px" }}
                  >
                    <button className="btn-ghost" onClick={close}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "2w-discovery" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "16px",
                      minHeight: "40px",
                    }}
                    dangerouslySetInnerHTML={{ __html: statusHtml }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn-ghost" onClick={close}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "1w-wizard" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "10px",
                      lineHeight: "1.5",
                    }}
                  >
                    Put device in pairing mode (hold programming button until
                    LED blinks), enter a name, then click Pair.
                  </p>

                  <input
                    type="text"
                    placeholder="Device name"
                    maxLength={31}
                    value={deviceName1w}
                    onInput={(e) => setDeviceName1w(e.currentTarget.value)}
                    style={{
                      width: "100%",
                      background: "var(--input-bg,var(--surface2))",
                      border: "1px solid var(--input-border,var(--surface3))",
                      borderRadius: "7px",
                      color: "var(--text)",
                      padding: "8px 12px",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      outline: "none",
                      marginBottom: "6px",
                      boxSizing: "border-box",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text3)",
                        width: "90px",
                        flexShrink: 0,
                      }}
                    >
                      Device type
                    </span>
                    <select
                      value={deviceType1w}
                      onChange={(e) =>
                        setDeviceType1w(parseInt(e.currentTarget.value, 10))
                      }
                      style={{
                        flex: 1,
                        background: "var(--input-bg,var(--surface2))",
                        border: "1px solid var(--input-border,var(--surface3))",
                        borderRadius: "6px",
                        color: "var(--text)",
                        padding: "6px 8px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                      }}
                    >
                      {DEVICE_TYPES.map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text3)",
                        width: "90px",
                        flexShrink: 0,
                      }}
                    >
                      Manufacturer
                    </span>
                    <select
                      value={manufacturer1w}
                      onChange={(e) =>
                        setManufacturer1w(parseInt(e.currentTarget.value, 10))
                      }
                      style={{
                        flex: 1,
                        background: "var(--input-bg,var(--surface2))",
                        border: "1px solid var(--input-border,var(--surface3))",
                        borderRadius: "6px",
                        color: "var(--text)",
                        padding: "6px 8px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                      }}
                    >
                      {MANUFACTURERS.map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {status && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        marginBottom: "10px",
                      }}
                    >
                      {status}
                    </p>
                  )}

                  <div
                    style={{ display: "flex", gap: "8px", marginTop: "16px" }}
                  >
                    <button
                      className="btn-danger-confirm"
                      onClick={send1wPairingFrames}
                    >
                      {t("button.pair") || "Pair"}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setStep("choose")}
                    >
                      {t("button.back") || "Back"}
                    </button>
                    <button className="btn-ghost" onClick={close}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "1w-confirm" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "16px",
                    }}
                  >
                    {status}
                  </p>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="btn-danger-confirm"
                      onClick={confirm1wPairing}
                    >
                      {t("button.confirm") || "Confirmed ✓"}
                    </button>
                    <button className="btn-ghost" onClick={resend1wPairing}>
                      {t("button.resend") || "Resend"}
                    </button>
                    <button className="btn-ghost" onClick={cancel1wPairing}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "add-by-address" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "10px",
                      lineHeight: "1.5",
                    }}
                  >
                    Enter the device address and select its type. The device
                    must already share the system key.
                  </p>

                  <input
                    type="text"
                    placeholder="Address (e.g. 750C4B)"
                    maxLength={6}
                    value={addressInput}
                    onInput={(e) =>
                      setAddressInput(e.currentTarget.value.toUpperCase())
                    }
                    style={{
                      width: "100%",
                      background: "var(--input-bg,var(--surface2))",
                      border: "1px solid var(--input-border,var(--surface3))",
                      borderRadius: "7px",
                      color: "var(--text)",
                      padding: "8px 12px",
                      fontSize: "13px",
                      fontFamily: "var(--mono)",
                      textTransform: "uppercase",
                      outline: "none",
                      marginBottom: "6px",
                      boxSizing: "border-box",
                    }}
                  />

                  <input
                    type="text"
                    placeholder="Name (optional — fetched automatically)"
                    maxLength={31}
                    value={nameInputAddress}
                    onInput={(e) => setNameInputAddress(e.currentTarget.value)}
                    style={{
                      width: "100%",
                      background: "var(--input-bg,var(--surface2))",
                      border: "1px solid var(--input-border,var(--surface3))",
                      borderRadius: "7px",
                      color: "var(--text)",
                      padding: "8px 12px",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      outline: "none",
                      marginBottom: "6px",
                      boxSizing: "border-box",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text3)",
                        width: "90px",
                        flexShrink: 0,
                      }}
                    >
                      Protocol
                    </span>
                    <select
                      value={protocolAddress}
                      onChange={(e) =>
                        setProtocolAddress(e.currentTarget.value)
                      }
                      style={{
                        flex: 1,
                        background: "var(--input-bg,var(--surface2))",
                        border: "1px solid var(--input-border,var(--surface3))",
                        borderRadius: "6px",
                        color: "var(--text)",
                        padding: "6px 8px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                      }}
                    >
                      <option value="2W">2W — Bidirectional</option>
                      <option value="1W">1W — Simplex</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text3)",
                        width: "90px",
                        flexShrink: 0,
                      }}
                    >
                      Device type
                    </span>
                    <select
                      value={deviceTypeAddress}
                      onChange={(e) =>
                        setDeviceTypeAddress(
                          parseInt(e.currentTarget.value, 10),
                        )
                      }
                      style={{
                        flex: 1,
                        background: "var(--input-bg,var(--surface2))",
                        border: "1px solid var(--input-border,var(--surface3))",
                        borderRadius: "6px",
                        color: "var(--text)",
                        padding: "6px 8px",
                        fontSize: "12px",
                        fontFamily: "inherit",
                      }}
                    >
                      <option value={0}>Unknown</option>
                      <option value={2}>Roller shutter</option>
                      <option value={3}>Awning</option>
                      <option value={10}>Blind</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <input
                      type="checkbox"
                      id="addr-lp"
                      checked={isLowPowerAddress}
                      onChange={(e) =>
                        setIsLowPowerAddress(e.currentTarget.checked)
                      }
                    />
                    <label
                      htmlFor="addr-lp"
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        cursor: "pointer",
                      }}
                    >
                      Low power device (battery-operated)
                    </label>
                  </div>

                  {status && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--text2)",
                        marginBottom: "10px",
                      }}
                    >
                      {status}
                    </p>
                  )}

                  <div
                    style={{ display: "flex", gap: "8px", marginTop: "16px" }}
                  >
                    <button
                      className="btn-danger-confirm"
                      onClick={addDeviceByAddress}
                    >
                      {t("button.add_device") || "Add Device"}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setStep("choose")}
                    >
                      {t("button.back") || "Back"}
                    </button>
                    <button className="btn-ghost" onClick={close}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "remote-capture" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "16px",
                    }}
                  >
                    {status}
                  </p>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn-ghost" onClick={close}>
                      {t("button.cancel") || "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {step === "remote-capture-confirm" && (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--text2)",
                      marginBottom: "16px",
                    }}
                  >
                    {status}
                  </p>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="btn-danger-confirm"
                      onClick={linkRemoteToDevice}
                    >
                      {t("button.link") || "Link"}
                    </button>
                    <button className="btn-ghost" onClick={close}>
                      {t("button.skip") || "Skip"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PairingWizardContext.Provider>
  );
}
