import {
  PAIRING_DEVICE_TYPES,
  PAIRING_MANUFACTURERS,
} from "../../models/Constants";
import type { TranslationParams } from "../../models/Types";

export type WizardTranslation = (
  key: string,
  params?: TranslationParams,
) => string;

type PairingStepProps = {
  t: WizardTranslation;
  close: () => void;
};

export function PairingChoiceStep({
  t,
  close,
  start2wDiscovery,
  go1wWizard,
  goAddressWizard,
}: PairingStepProps & {
  start2wDiscovery: () => void;
  go1wWizard: () => void;
  goAddressWizard: () => void;
}) {
  return (
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
          (e.currentTarget as HTMLElement).style.background = "var(--surface3)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--blue,#5b9ecf)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--surface2)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--separator)";
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
          The device reports its real position back to the controller. Supports
          auto-calibration and accurate position tracking. Required for Somfy RS100
          IO, Velux, and similar modern motors.
        </div>
      </div>

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
          (e.currentTarget as HTMLElement).style.background = "var(--surface3)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--blue,#5b9ecf)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--surface2)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--separator)";
        }}
        onClick={go1wWizard}
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
          Commands are sent only; the device never replies. Position is estimated by
          a timer — manual calibration needed. Used for older or budget motors that do
          not send status.
        </div>
      </div>

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
          (e.currentTarget as HTMLElement).style.background = "var(--surface3)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--blue,#5b9ecf)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--surface2)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--separator)";
        }}
        onClick={goAddressWizard}
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
          Device already has the system key — enter its address directly. Use when
          re-adding a known device after a controller reset. No radio pairing needed.
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button className="btn-ghost" onClick={close}>
          {t("button.cancel") || "Cancel"}
        </button>
      </div>
    </div>
  );
}

export function PairingTwoWireDiscoveryStep({
  t,
  statusText,
  isError,
  close,
}: PairingStepProps & { statusText: string; isError: boolean }) {
  return (
    <div>
      <p
        style={{
          fontSize: "13px",
          color: isError ? "var(--red)" : "var(--text2)",
          marginBottom: "16px",
          minHeight: "40px",
        }}
      >
        {statusText}
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button className="btn-ghost" onClick={close}>
          {t("button.cancel") || "Cancel"}
        </button>
      </div>
    </div>
  );
}

export function PairingOneWireWizardStep({
  t,
  deviceName1w,
  deviceType1w,
  manufacturer1w,
  status,
  setDeviceName1w,
  setDeviceType1w,
  setManufacturer1w,
  send1wPairingFrames,
  goToChoose,
  close,
}: PairingStepProps & {
  deviceName1w: string;
  deviceType1w: number;
  manufacturer1w: number;
  status: string;
  setDeviceName1w: (value: string) => void;
  setDeviceType1w: (value: number) => void;
  setManufacturer1w: (value: number) => void;
  send1wPairingFrames: () => void;
  goToChoose: () => void;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: "13px",
          color: "var(--text2)",
          marginBottom: "10px",
          lineHeight: "1.5",
        }}
      >
        Put device in pairing mode (hold programming button until LED blinks), enter
        a name, then click Pair.
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

      <SelectRow
        label="Device type"
        value={deviceType1w}
        onChange={(value) => setDeviceType1w(value)}
        options={PAIRING_DEVICE_TYPES}
      />

      <SelectRow
        label="Manufacturer"
        value={manufacturer1w}
        onChange={(value) => setManufacturer1w(value)}
        options={PAIRING_MANUFACTURERS}
      />

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

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button className="btn-danger-confirm" onClick={send1wPairingFrames}>
          {t("button.pair") || "Pair"}
        </button>
        <button className="btn-ghost" onClick={goToChoose}>
          {t("button.back") || "Back"}
        </button>
        <button className="btn-ghost" onClick={close}>
          {t("button.cancel") || "Cancel"}
        </button>
      </div>
    </div>
  );
}

export function PairingOneWireConfirmStep({
  t,
  status,
  confirm1wPairing,
  resend1wPairing,
  cancel1wPairing,
}: PairingStepProps & {
  status: string;
  confirm1wPairing: () => void;
  resend1wPairing: () => void;
  cancel1wPairing: () => void;
}) {
  return (
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
        <button className="btn-danger-confirm" onClick={confirm1wPairing}>
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
  );
}

export function PairingAddByAddressStep({
  t,
  addressInput,
  nameInputAddress,
  protocolAddress,
  deviceTypeAddress,
  isLowPowerAddress,
  status,
  setAddressInput,
  setNameInputAddress,
  setProtocolAddress,
  setDeviceTypeAddress,
  setIsLowPowerAddress,
  addDeviceByAddress,
  goToChoose,
  close,
}: PairingStepProps & {
  addressInput: string;
  nameInputAddress: string;
  protocolAddress: string;
  deviceTypeAddress: number;
  isLowPowerAddress: boolean;
  status: string;
  setAddressInput: (value: string) => void;
  setNameInputAddress: (value: string) => void;
  setProtocolAddress: (value: string) => void;
  setDeviceTypeAddress: (value: number) => void;
  setIsLowPowerAddress: (value: boolean) => void;
  addDeviceByAddress: () => void;
  goToChoose: () => void;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: "13px",
          color: "var(--text2)",
          marginBottom: "10px",
          lineHeight: "1.5",
        }}
      >
        Enter the device address and select its type. The device must already share
        the system key.
      </p>

      <input
        type="text"
        placeholder="Address (e.g. 750C4B)"
        maxLength={6}
        value={addressInput}
        onInput={(e) => setAddressInput(e.currentTarget.value.toUpperCase())}
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
          onChange={(e) => setProtocolAddress(e.currentTarget.value)}
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
          onChange={(e) => setDeviceTypeAddress(parseInt(e.currentTarget.value, 10))}
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
          onChange={(e) => setIsLowPowerAddress(e.currentTarget.checked)}
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

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button className="btn-danger-confirm" onClick={addDeviceByAddress}>
          {t("button.add_device") || "Add Device"}
        </button>
        <button className="btn-ghost" onClick={goToChoose}>
          {t("button.back") || "Back"}
        </button>
        <button className="btn-ghost" onClick={close}>
          {t("button.cancel") || "Cancel"}
        </button>
      </div>
    </div>
  );
}

export function PairingRemoteCaptureStep({
  t,
  status,
  close,
}: PairingStepProps & { status: string }) {
  return (
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
  );
}

export function PairingRemoteCaptureConfirmStep({
  t,
  status,
  linkRemoteToDevice,
  close,
}: PairingStepProps & {
  status: string;
  linkRemoteToDevice: () => void;
}) {
  return (
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
        <button className="btn-danger-confirm" onClick={linkRemoteToDevice}>
          {t("button.link") || "Link"}
        </button>
        <button className="btn-ghost" onClick={close}>
          {t("button.skip") || "Skip"}
        </button>
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: ReadonlyArray<readonly [number, string]>;
}) {
  return (
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
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.currentTarget.value, 10))}
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
        {options.map(([val, labelText]) => (
          <option key={val} value={val}>
            {labelText}
          </option>
        ))}
      </select>
    </div>
  );
}
