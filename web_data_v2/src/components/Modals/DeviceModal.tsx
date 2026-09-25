import { useState } from "preact/hooks";
import { Device } from "../../models/Types.ts";
import { NameRow } from "../deviceSettings/NameRow.tsx";
import { PositionRow } from "../deviceSettings/PositionRow.tsx";
import { TransitTimeRow } from "../deviceSettings/TransitTimeRow.tsx";
import { InvertOpenCloseRow } from "../deviceSettings/InvertOpenCloseRow.tsx";
import { QuietModeRow } from "../deviceSettings/QuietModeRow.tsx";
import { IdentifyRow } from "../deviceSettings/IdentifyRow.tsx";
import { DeviceTypeRow } from "../deviceSettings/DeviceTypeRow.tsx";
import { ResetPositionRow } from "../deviceSettings/ResetPositionRow.tsx";
import { BrandRow } from "../deviceSettings/BrandRow.tsx";
import { PairingModeRow } from "../deviceSettings/PairingModeRow.tsx";
import { FavoritePositionRow } from "../deviceSettings/FavoritePositionRow.tsx";
import { DangerZone } from "../deviceSettings/DangerZone.tsx";

interface DeviceModalProps {
  device: Device;
  onClose?: () => void;
}

export function DeviceModal({ device, onClose }: DeviceModalProps) {
  const [deviceState, setDeviceState] = useState<Device>(device);

  const deviceMeta = [
    deviceState.type_name,
    deviceState.manufacturer,
    deviceState.id,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div id="device-edit-modal" class="open">
      <div class="dev-sheet">
        <div class="dev-sheet-handle"></div>
        <div class="dev-sheet-header">
          <div class="dev-sheet-title">
            <div class="dev-sheet-name" id="dev-sheet-name">
              {deviceState.name}
            </div>
            <div class="dev-sheet-meta" id="dev-sheet-meta">
              {deviceMeta}
            </div>
          </div>
          <button id="device-edit-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div class="dev-sheet-body">
          <NameRow
            device={deviceState}
            setDeviceState={setDeviceState}
            onClose={onClose}
          />
          <PositionRow device={deviceState} setDeviceState={setDeviceState} />
          <TransitTimeRow
            device={deviceState}
            setDeviceState={setDeviceState}
            onClose={onClose}
          />
          <InvertOpenCloseRow
            device={deviceState}
            setDeviceState={setDeviceState}
          />
          <QuietModeRow device={deviceState} setDeviceState={setDeviceState} />
          <IdentifyRow device={deviceState} setDeviceState={setDeviceState} />
          <DeviceTypeRow
            device={deviceState}
            setDeviceState={setDeviceState}
            onClose={onClose}
          />
          <ResetPositionRow
            device={deviceState}
            setDeviceState={setDeviceState}
          />
          <BrandRow device={deviceState} setDeviceState={setDeviceState} />
          <PairingModeRow
            device={deviceState}
            setDeviceState={setDeviceState}
          />
          <FavoritePositionRow
            device={deviceState}
            setDeviceState={setDeviceState}
          />
          <DangerZone
            device={deviceState}
            setDeviceState={setDeviceState}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
