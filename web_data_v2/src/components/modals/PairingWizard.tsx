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
import { ToastType } from "../../models/Types";
import { useOtaKey } from "../../hooks/api/useOtaKey.tsx";
import { postAction } from "../deviceSettings/shared";
import type { PairingWizardApi } from "../../models/Types";
import {
  PairingAddByAddressStep,
  PairingChoiceStep,
  PairingOneWireConfirmStep,
  PairingOneWireWizardStep,
  PairingRemoteCaptureConfirmStep,
  PairingRemoteCaptureStep,
  PairingTwoWireDiscoveryStep,
} from "./PairingWizardSteps";

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
  const [discoveryStatusText, setDiscoveryStatusText] = useState("");
  const [isDiscoveryError, setIsDiscoveryError] = useState(false);

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
    setDiscoveryStatusText("");
    setIsDiscoveryError(false);
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
    setDiscoveryStatusText("");
    setIsDiscoveryError(false);
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
    setDiscoveryStatusText("");
    setIsDiscoveryError(false);
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
      headers: { "Content-Type": "application/json",
      "X-OTA-Key": otaKey.data?.key || ""},
    }).catch((e) => {
      clearCountdownTimer();
      setDiscoveryStatusText(
        `${t("popup.pair_failed") || "Pairing request failed."} ${e.message}`,
      );
      setIsDiscoveryError(true);
    });
  }, [t, clearCountdownTimer, otaKey.data?.key]);

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
        setDiscoveryStatusText(
          data.message ||
            t("popup.pair_key_mismatch") ||
            "Device found but has a different system key. Factory reset the device and try again.",
        );
        setIsDiscoveryError(true);
      } else {
        setDiscoveryStatusText(t("popup.pair_timeout") || "No device found.");
        setIsDiscoveryError(false);
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
      headers: { "Content-Type": "application/json",
        "X-OTA-Key": otaKey.data?.key || ""
      },
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
      setDiscoveryStatusText(
        `${t("popup.pair_step2_scanning") || "Scanning up to 2 minutes..."} ${display}`,
      );
      setIsDiscoveryError(false);
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
                <PairingChoiceStep
                  t={t}
                  close={close}
                  start2wDiscovery={start2wDiscovery}
                  go1wWizard={() => {
                    setDeviceName1w("");
                    setDeviceType1w(2);
                    setManufacturer1w(2);
                    setStep("1w-wizard");
                  }}
                  goAddressWizard={() => {
                    setAddressInput("");
                    setNameInputAddress("");
                    setProtocolAddress("2W");
                    setDeviceTypeAddress(0);
                    setIsLowPowerAddress(false);
                    setStep("add-by-address");
                  }}
                />
              )}

              {step === "2w-discovery" && (
                <PairingTwoWireDiscoveryStep
                  t={t}
                  close={close}
                  statusText={discoveryStatusText}
                  isError={isDiscoveryError}
                />
              )}

              {step === "1w-wizard" && (
                <PairingOneWireWizardStep
                  t={t}
                  close={close}
                  deviceName1w={deviceName1w}
                  deviceType1w={deviceType1w}
                  manufacturer1w={manufacturer1w}
                  status={status}
                  setDeviceName1w={setDeviceName1w}
                  setDeviceType1w={setDeviceType1w}
                  setManufacturer1w={setManufacturer1w}
                  send1wPairingFrames={send1wPairingFrames}
                  goToChoose={() => setStep("choose")}
                />
              )}

              {step === "1w-confirm" && (
                <PairingOneWireConfirmStep
                  t={t}
                  close={close}
                  status={status}
                  confirm1wPairing={confirm1wPairing}
                  resend1wPairing={resend1wPairing}
                  cancel1wPairing={cancel1wPairing}
                />
              )}

              {step === "add-by-address" && (
                <PairingAddByAddressStep
                  t={t}
                  close={close}
                  addressInput={addressInput}
                  nameInputAddress={nameInputAddress}
                  protocolAddress={protocolAddress}
                  deviceTypeAddress={deviceTypeAddress}
                  isLowPowerAddress={isLowPowerAddress}
                  status={status}
                  setAddressInput={setAddressInput}
                  setNameInputAddress={setNameInputAddress}
                  setProtocolAddress={setProtocolAddress}
                  setDeviceTypeAddress={setDeviceTypeAddress}
                  setIsLowPowerAddress={setIsLowPowerAddress}
                  addDeviceByAddress={addDeviceByAddress}
                  goToChoose={() => setStep("choose")}
                />
              )}

              {step === "remote-capture" && (
                <PairingRemoteCaptureStep
                  t={t}
                  close={close}
                  status={status}
                />
              )}

              {step === "remote-capture-confirm" && (
                <PairingRemoteCaptureConfirmStep
                  t={t}
                  close={close}
                  status={status}
                  linkRemoteToDevice={linkRemoteToDevice}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </PairingWizardContext.Provider>
  );
}
