import { WifiSettings } from "../components/settings/Wifi";
import { NetworkSettings } from "../components/settings/Network";
import { FallbackApSettings } from "../components/settings/FallbackAp";
import { MqttSettings } from "../components/settings/Mqtt";
import { SyslogSettings } from "../components/settings/Syslog";
import { SomfySettings } from "../components/settings/Somfy";
import { ControllerSettings } from "../components/settings/Controller";
import { IoSystemKeySettings } from "../components/settings/IoSystemKey";
import { OtaKeySettings } from "../components/settings/OtaKey";
import { FirmwareSettings } from "../components/settings/Firmware";
import { WebUISettings } from "../components/settings/WebUi";
import { WebUIUpdateSettings } from "../components/settings/WebUiUpdate";
import { BackupSettings } from "../components/settings/Backup";
import { RebootSettings } from "../components/settings/Reboot";
import { SoftwareUpdateSettings } from "../components/settings/SoftwareUpdate";
import { FirmwareUpdateSettings } from "../components/settings/FirmwareUpdate";
import { PairingLogs } from "../components/settings/PairingLogs";
import { useInfo } from "../hooks/api/useInfo";

export function Settings() {
  const infoData = useInfo();
  return (
    <section class="view active">
      <div class="view-header">
        <h2 class="view-title" data-i18n="nav.settings">
          Settings
        </h2>
      </div>

      <div class="settings-group">
        <div class="settings-group-label" data-i18n="settings.group.network">
          Network
        </div>
        <div class="settings-card">
          <WifiSettings />
          <NetworkSettings />
          <FallbackApSettings />
        </div>
      </div>

      <div class="settings-group">
        <div
          class="settings-group-label"
          data-i18n="settings.group.integration"
        >
          Integration
        </div>
        <div class="settings-card">
          <MqttSettings />
          <SyslogSettings />
          <SomfySettings />
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-label" data-i18n="settings.group.security">
          Security
        </div>
        <div class="settings-card">
          <ControllerSettings />
          <IoSystemKeySettings />
          <OtaKeySettings />
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-label" data-i18n="settings.group.system">
          System
        </div>
        <div class="settings-card">
          <FirmwareSettings data={infoData.data} />
          <WebUISettings data={infoData.data} />
          <WebUIUpdateSettings />
          <FirmwareUpdateSettings />
          <BackupSettings />
          <PairingLogs />
          <RebootSettings />
          <SoftwareUpdateSettings />
        </div>
      </div>
    </section>
  );
}
