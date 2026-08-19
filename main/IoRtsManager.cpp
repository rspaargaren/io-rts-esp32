#include "IoRtsManager.hpp"
#include "HardwareConfig.hpp"
#include "MqttConfig.hpp"
#include "IoHomeConfig.hpp"
#include "DeviceStorage.hpp"
#include "web_server.h"

#include "esp_log.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "sdkconfig.h"

static const char *TAG = "ioRtsMan";

#include <format>
#include <vector>

using namespace Helpers;
using namespace Config;

namespace IoRts
{
    static IoRtsManager *sIoRtsManager; // Pointer to IoRtsManager isntance
    static MqttHelpers *sMqttHelper;    // Pointer to MQTT instance to manage MQTT communication layer
    static volatile bool sCaptureActive = false; // true while a remote capture window is open

    static void unknownSenderCallback(const std::string &senderID)
    {
        if (!sCaptureActive)
            return;
        ESP_LOGI(TAG, "Remote capture: unknown sender %s", senderID.c_str());
#if CONFIG_WEB_ENABLED
        web_server_broadcast_message(std::format("{{\"type\":\"remote_seen\",\"id\":\"{}\"}}", senderID).c_str());
#endif
    }

    static void keySniffCallback(const std::string &hexKey)
    {
        ESP_LOGI(TAG, "Key sniff: captured key %s", hexKey.c_str());
#if CONFIG_WEB_ENABLED
        web_server_broadcast_message(std::format("{{\"type\":\"io_key_captured\",\"key\":\"{}\"}}", hexKey).c_str());
#endif
    }

    static void loggerCallback(esp_log_level_t log_level, const char *tag, std::string log)
    {
        char level;
        switch (log_level)
        {
        case ESP_LOG_ERROR:
            ESP_LOGE(tag, "%s", log.c_str());
            level = 'E';
            break;
        case ESP_LOG_WARN:
            ESP_LOGW(tag, "%s", log.c_str());
            level = 'W';
            break;
        case ESP_LOG_INFO:
            ESP_LOGI(tag, "%s", log.c_str());
            level = 'I';
            break;
        default:
            level = '?';
            break;
        }
        if (sMqttHelper != nullptr) sMqttHelper->SendLog(std::format("{} {}: {}", level, tag, log));
#if CONFIG_WEB_ENABLED
        web_server_broadcast_log(std::format("{} {}: {}", level, tag, log).c_str());
#endif
    }

    static void deviceStatusCallback(const std::string deviceID, const iohome::IoDevice &device)
    {
        ESP_LOGI(TAG, "Callback received device status for %s: %s (0x%02X/0x%02X) / Position %.1f / Target %0.1f / Tilt %.1f / Moving: %s / Inverted: %s / Deleted: %s",
                 deviceID.c_str(), device.info.name, device.info.device_type, device.info.device_subtype,
                 device.position, device.target, device.tilt,
                 device.is_stopped ? "No" : "Yes", device.info.is_openclose_inverted ? "Yes" : "No", device.is_deleted ? "Yes" : "No");
        if (sIoRtsManager == nullptr)
            return;
        if (!sIoRtsManager->isIoPassive()                                                                 // not passive mode
            && (device.info.device_type != iohome::DeviceType::UNKNOWN) && (strlen(device.info.name) > 0) // we have at least device name and type
            && (!device.is_deleted))                                                                      // device is not deleted
        {
            bool sendDiscovery = false;
            // So we can process device status
            sIoRtsManager->mIoDevicesMutex.lock(); // Take mutex
            if (!sIoRtsManager->mIoDevices.contains(deviceID))
            {
                // We have a new device detected!
                // add device to mIoDevices
                sIoRtsManager->mIoDevices.insert({deviceID, device});
                // ask for discovery message
                sendDiscovery = true;
                // add device to flash storage
                Helpers::StoredIoDevice storedDevice = {};
                storedDevice.device = device;
                Helpers::DeviceStorage::SaveIoDevice(deviceID, storedDevice);
                // broadcast device_added WebSocket event
#if CONFIG_WEB_ENABLED
                web_server_broadcast_message(
                    std::format("{{\"type\":\"device_added\",\"id\":\"{}\",\"name\":\"{}\"}}", deviceID, device.info.name).c_str());
#endif
            }
            else
            {
                // update mIoDevices!
                auto it = sIoRtsManager->mIoDevices.find(deviceID); // we have something as we found it just before
                if (it->second.is_deleted)
                {
                    // revert 'deleted' status and send MQTT discovery as device has been added again
                    sendDiscovery = true;
                    it->second.is_deleted = false;
                }
                if (strcmp(it->second.info.name, device.info.name) != 0)
                {
                    sendDiscovery = true;
                    memcpy(it->second.info.name, device.info.name, sizeof(device.info.name)); // could be update by "SetName"
                }
                // Update device type/subtype if they were unknown and now available (should not happen, just in case...)
                if (it->second.info.device_type == iohome::DeviceType::UNKNOWN && device.info.device_type != iohome::DeviceType::UNKNOWN)
                {
                    sendDiscovery = true;
                    it->second.info.device_type = device.info.device_type;
                    it->second.info.device_subtype = device.info.device_subtype;
                    it->second.info.manufacturer = device.info.manufacturer;
                }
                // Update flags if changed
                if (it->second.info.is_openclose_inverted != device.info.is_openclose_inverted)
                {
                    sendDiscovery = true;
                    it->second.info.is_openclose_inverted = device.info.is_openclose_inverted;
                }
                it->second.is_stopped = device.is_stopped;
                if (device.is_stopped && std::abs(device.position - device.target) <= 2.0f)
                    it->second.move_start_us = 0;
                it->second.last_status_timestamp = device.last_status_timestamp;
                it->second.next_status_update_timestamp = device.next_status_update_timestamp;
                it->second.position = device.position;
                it->second.target = device.target;
                it->second.tilt = device.tilt;
                // Update storage when static device info changed (name, type, ...)
                if (sendDiscovery)
                {
                    // Load existing file to preserve linked remotes, then update device info
                    Helpers::StoredIoDevice storedDevice = {};
                    storedDevice.device = it->second;
                    Helpers::StoredIoDevice existing;
                    if (Helpers::DeviceStorage::LoadIoDevice(deviceID, existing) == ESP_OK)
                    {
                        storedDevice.linked_remotes  = existing.linked_remotes;
                        storedDevice.transit_time_ms = existing.transit_time_ms;
                        storedDevice.quiet           = existing.quiet;
                        storedDevice.local_name      = existing.local_name;
                    }
                    Helpers::DeviceStorage::SaveIoDevice(deviceID, storedDevice);
                }
            }
            sIoRtsManager->mIoDevicesMutex.unlock(); // release mutex as MQTT needs it!
#if CONFIG_WEB_ENABLED
            if (device.position != iohome::UNKNOWN_POSITION)
                web_server_broadcast_position(deviceID.c_str(), (int)device.position, device.is_stopped, false);
#endif
            // send MQTT messages
            if (sMqttHelper != nullptr)
            {
                // send MQTT discovery message
                if (sendDiscovery)
                    sMqttHelper->SendDiscovery();
                // send status update
                sMqttHelper->SendIoDeviceStatus(deviceID);
            }
        }
    }

    // ── Interpolation timer ─────────────────────────────────────────────────

    static void interpolation_timer_cb(void *arg)
    {
        if (!sIoRtsManager) return;
        int64_t now = esp_timer_get_time();

        sIoRtsManager->mIoDevicesMutex.lock();
        for (auto &[id, dev] : sIoRtsManager->mIoDevices)
        {
            if (dev.move_start_us == 0 || dev.transit_time_ms == 0)
                continue;
            int64_t elapsed_ms = (now - dev.move_start_us) / 1000;
            float fraction = (float)elapsed_ms / (float)dev.transit_time_ms;
            if (fraction > 1.0f) fraction = 1.0f;
            float estimated = dev.move_start_pos + (dev.move_target_pos - dev.move_start_pos) * fraction;
            int estimated_int = (int)estimated;
            // Derive open/opening/closing/closed state from movement direction
            const char *state = nullptr;
            if (fraction >= 1.0f)
            {
                if (dev.info.is_openclose_inverted)
                    state = (dev.move_target_pos < 0.1f) ? "closed" : "open";
                else
                    state = (dev.move_target_pos > 99.9f) ? "closed" : "open";
            }
            else if (dev.move_target_pos > dev.move_start_pos)
                state = dev.info.is_openclose_inverted ? "opening" : "closing";
            else if (dev.move_target_pos < dev.move_start_pos)
                state = dev.info.is_openclose_inverted ? "closing" : "opening";
#if CONFIG_WEB_ENABLED
            web_server_broadcast_position(id.c_str(), estimated_int, false, true);
#endif
            if (sMqttHelper != nullptr)
                sMqttHelper->PublishEstimatedPosition(id, estimated_int, state);

            // Stop broadcasting once clamped (device should report back soon)
            if (fraction >= 1.0f)
                dev.move_start_us = 0;
        }
        sIoRtsManager->mIoDevicesMutex.unlock();
    }

    IoRtsManager::IoRtsManager()
    {
        sIoRtsManager = this;
        // Initialize IO objects
        InitializeIo();
        // Load devices from flash storage — runs before high-priority tasks start
        // so RestoreDevice can acquire sMutex without contention.
        LoadIoDevicesFromStorage();
        // Now start P8/P6/P4 tasks (they compete for sMutex; devices already loaded)
        if (mIoHome != nullptr)
            mIoHome->StartTasks();
        // Initialize MQTT objects
        InitializeMqtt();
        // Start everything
        if (mIoHome != nullptr)
        {
            mIoHome->StartReceive();
        }
        if (sMqttHelper != nullptr)
        {
            sMqttHelper->StartMqttClient();
        }
        // Start interpolation timer (fires every 1 s)
        esp_timer_create_args_t ta = {};
        ta.callback = interpolation_timer_cb;
        ta.name = "interp";
        esp_timer_handle_t th;
        if (esp_timer_create(&ta, &th) == ESP_OK)
            esp_timer_start_periodic(th, 1000000); // 1 s
    }
    void IoRtsManager::Reboot()
    {
        if (mIoHome != nullptr)
            mIoHome->StopReceive();
        esp_restart();
    }
    void IoRtsManager::RemoveIoDevice(const std::string &deviceID)
    {
        // Legacy method — delegates to DeactivateDevice
        DeactivateDevice(deviceID);
    }
    void IoRtsManager::DeactivateDevice(const std::string &deviceID)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        if (it == mIoDevices.end())
        {
            mIoDevicesMutex.unlock();
            ESP_LOGE(TAG, "DeactivateDevice: unknown %s", deviceID.c_str());
            return;
        }
        if (it->second.is_deleted)
        {
            mIoDevicesMutex.unlock();
            ESP_LOGW(TAG, "DeactivateDevice: already inactive %s", deviceID.c_str());
            return;
        }
        if (mIoHome != nullptr)
            mIoHome->DeleteDevice(deviceID);
        it->second.is_deleted = true;
        // Save updated device to NVS (keeps file, just marks is_deleted=true)
        Helpers::StoredIoDevice storedDevice = {};
        storedDevice.device = it->second;
        Helpers::StoredIoDevice existing;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, existing) == ESP_OK)
        {
            storedDevice.linked_remotes  = existing.linked_remotes;
            storedDevice.transit_time_ms = existing.transit_time_ms;
            storedDevice.quiet           = existing.quiet;
            storedDevice.local_name      = existing.local_name;
        }
        Helpers::DeviceStorage::SaveIoDevice(deviceID, storedDevice);
        mIoDevicesMutex.unlock();
        if (sMqttHelper != nullptr)
        {
            sMqttHelper->SendDiscovery();
            sMqttHelper->SendIoDeviceStatus(deviceID);
            sMqttHelper->PublishInactiveDevicesList();
        }
#if CONFIG_WEB_ENABLED
        web_server_broadcast_device_event(deviceID.c_str(), "device_deactivated");
#endif
        ESP_LOGI(TAG, "Device deactivated: %s", deviceID.c_str());
    }

    void IoRtsManager::ReactivateDevice(const std::string &deviceID)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        if (it == mIoDevices.end())
        {
            mIoDevicesMutex.unlock();
            ESP_LOGE(TAG, "ReactivateDevice: unknown %s", deviceID.c_str());
            return;
        }
        if (!it->second.is_deleted)
        {
            mIoDevicesMutex.unlock();
            ESP_LOGW(TAG, "ReactivateDevice: already active %s", deviceID.c_str());
            return;
        }
        it->second.is_deleted = false;
        if (mIoHome != nullptr)
            mIoHome->RestoreDevice(deviceID, it->second);
        // Save updated device to NVS and restore remote links
        Helpers::StoredIoDevice storedDevice = {};
        storedDevice.device = it->second;
        Helpers::StoredIoDevice existing;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, existing) == ESP_OK)
        {
            storedDevice.linked_remotes  = existing.linked_remotes;
            storedDevice.transit_time_ms = existing.transit_time_ms;
            storedDevice.quiet           = existing.quiet;
            storedDevice.local_name      = existing.local_name;
        }
        Helpers::DeviceStorage::SaveIoDevice(deviceID, storedDevice);
        mIoDevicesMutex.unlock();
        // Re-link remotes in radio layer
        if (mIoHome != nullptr)
            for (const std::string &remoteID : storedDevice.linked_remotes)
                mIoHome->LinkRemoteToDevice(remoteID, deviceID);
        if (sMqttHelper != nullptr)
        {
            sMqttHelper->SendDiscovery();
            sMqttHelper->SendIoDeviceStatus(deviceID);
            sMqttHelper->PublishInactiveDevicesList();
        }
#if CONFIG_WEB_ENABLED
        web_server_broadcast_device_event(deviceID.c_str(), "device_reactivated");
#endif
        ESP_LOGI(TAG, "Device reactivated: %s", deviceID.c_str());
    }

    bool IoRtsManager::DeleteDevice(const std::string &deviceID)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        if (it == mIoDevices.end())
        {
            mIoDevicesMutex.unlock();
            ESP_LOGE(TAG, "DeleteDevice: unknown %s", deviceID.c_str());
            return false;
        }
        if (!it->second.is_deleted)
        {
            mIoDevicesMutex.unlock();
            ESP_LOGE(TAG, "DeleteDevice: device %s is still active — deactivate first", deviceID.c_str());
            return false;
        }
        mIoDevices.erase(it);
        mIoDevicesMutex.unlock();
        Helpers::DeviceStorage::RemoveIoDevice(deviceID);
        if (sMqttHelper != nullptr)
        {
            sMqttHelper->SendDiscovery();
            sMqttHelper->SendIoDeviceStatus(deviceID);
            sMqttHelper->PublishInactiveDevicesList();
        }
#if CONFIG_WEB_ENABLED
        web_server_broadcast_device_event(deviceID.c_str(), "device_deleted");
#endif
        ESP_LOGI(TAG, "Device permanently deleted: %s", deviceID.c_str());
        return true;
    }

    bool IoRtsManager::LinkRemoteToDevice(const std::string &remoteID, const std::string &deviceID)
    {
        if (mIoHome == nullptr) return false;
        bool success = mIoHome->LinkRemoteToDevice(remoteID, deviceID);
        if (success)
        {
            Helpers::DeviceStorage::AddRemoteToIoDevice(remoteID, deviceID);
            if (sMqttHelper != nullptr)
                sMqttHelper->PublishDeviceRemotesList(deviceID);
        }
        return success;
    }
    void IoRtsManager::RemoveIoRemote(const std::string &remoteID)
    {
        if (mIoHome != nullptr)
            mIoHome->DeleteRemote(remoteID);
        Helpers::DeviceStorage::RemoveRemoteFromIoDevices(remoteID);
        // Refresh remotes sensor for all active devices (remote may have been linked to any of them)
        if (sMqttHelper != nullptr)
        {
            std::vector<std::string> activeIDs;
            mIoDevicesMutex.lock();
            for (const auto &[id, dev] : mIoDevices)
                if (!dev.is_deleted)
                    activeIDs.push_back(id);
            mIoDevicesMutex.unlock();
            for (const std::string &id : activeIDs)
                sMqttHelper->PublishDeviceRemotesList(id);
        }
    }
    void IoRtsManager::LoadIoDevicesFromStorage()
    {
        if (mIoHome == nullptr)
            return;

        std::map<std::string, Helpers::StoredIoDevice> storedDevices;
        esp_err_t err = Helpers::DeviceStorage::LoadAllIoDevices(storedDevices);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "Failed to load devices from storage (%s)", esp_err_to_name(err));
            return;
        }

        for (const auto &[deviceID, storedDevice] : storedDevices)
        {
            // Copy persisted fields from storage into the in-memory device
            iohome::IoDevice dev = storedDevice.device;
            dev.transit_time_ms = storedDevice.transit_time_ms;
            dev.quiet = storedDevice.quiet;
            strncpy(dev.local_name, storedDevice.local_name.c_str(), sizeof(dev.local_name) - 1);
            dev.local_name[sizeof(dev.local_name) - 1] = '\0';

            // Add to our local map regardless of active/inactive state
            mIoDevicesMutex.lock();
            mIoDevices.insert({deviceID, dev});
            mIoDevicesMutex.unlock();
            if (!dev.is_deleted)
            {
                bool is1w = (dev.info.protocol_mode == iohome::ProtocolMode::PROTO_1W);
                if (!is1w)
                {
                    // Only register 2W devices with the radio layer.
                    // 1W devices are simplex — registering them with IoHomeControl
                    // would trigger 2W status polls that never get a response.
                    mIoHome->RestoreDevice(deviceID, dev);
                }
                for (const std::string &remoteID : storedDevice.linked_remotes)
                    mIoHome->LinkRemoteToDevice(remoteID, deviceID);
                ESP_LOGI(TAG, "Restored %s device %s (%s) with %u remote(s), transit=%ums",
                         is1w ? "1W" : "2W", deviceID.c_str(), dev.info.name,
                         storedDevice.linked_remotes.size(), dev.transit_time_ms);
            }
            else
            {
                ESP_LOGI(TAG, "Loaded inactive device %s (%s) — not registered with radio",
                         deviceID.c_str(), dev.info.name);
            }
        }
    }
    void IoRtsManager::StartRemoteCapture()
    {
        sCaptureActive = true;
        ESP_LOGI(TAG, "Remote capture window opened");
    }

    void IoRtsManager::StopRemoteCapture()
    {
        sCaptureActive = false;
        ESP_LOGI(TAG, "Remote capture window closed");
    }

    bool IoRtsManager::IsCaptureActive() const
    {
        return sCaptureActive;
    }

    // ── Confirmation poll ────────────────────────────────────────────────────

    struct ConfirmPollArg {
        IoRtsManager *manager;
        char deviceID[8]; // 6-char hex + null
        esp_timer_handle_t timer;  // handle so the callback can delete itself
    };

    static void confirmation_poll_cb(void *arg)
    {
        auto *a = static_cast<ConfirmPollArg *>(arg);
        if (a->manager && a->manager->mIoHome)
        {
            ESP_LOGI("ioRtsMan", "Confirmation poll for %s", a->deviceID);
            a->manager->mIoHome->ForceDeviceStatusUpdate(a->deviceID);
        }
        if (a->timer) esp_timer_delete(a->timer);
        delete a;
    }

    void IoRtsManager::ScheduleConfirmationPoll(const std::string &deviceID, uint32_t transit_time_ms, float distance_fraction)
    {
        // Delay = transit_time * distance + 3 s offset; fallback = 60 s
        uint64_t delay_us;
        if (transit_time_ms > 0)
            delay_us = (uint64_t)((float)transit_time_ms * distance_fraction * 1000) + 3000000ULL;
        else
            delay_us = 60000000ULL; // 60 s fallback

        auto *arg = new ConfirmPollArg();
        arg->manager = this;
        strncpy(arg->deviceID, deviceID.c_str(), sizeof(arg->deviceID) - 1);
        arg->deviceID[sizeof(arg->deviceID) - 1] = '\0';
        arg->timer = nullptr;

        esp_timer_create_args_t ta = {};
        ta.callback = confirmation_poll_cb;
        ta.arg = arg;
        ta.name = "conf_poll";
        esp_timer_handle_t th;
        if (esp_timer_create(&ta, &th) == ESP_OK) {
            arg->timer = th;
            esp_timer_start_once(th, delay_us);
        } else {
            delete arg;
        }
    }

    bool IoRtsManager::SetTransitTime(const std::string &deviceID, uint32_t transit_time_ms)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool found = it != mIoDevices.end();
        if (found)
            it->second.transit_time_ms = transit_time_ms;
        mIoDevicesMutex.unlock();

        if (!found)
            return false;

        Helpers::StoredIoDevice stored;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, stored) != ESP_OK)
            return false;
        stored.transit_time_ms = transit_time_ms;
        esp_err_t err = Helpers::DeviceStorage::SaveIoDevice(deviceID, stored);
        if (err == ESP_OK)
            ESP_LOGI(TAG, "Transit time for %s set to %ums", deviceID.c_str(), transit_time_ms);
        return err == ESP_OK;
    }

    bool IoRtsManager::SetQuiet(const std::string &deviceID, bool quiet)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool found = it != mIoDevices.end();
        if (found)
            it->second.quiet = quiet;
        mIoDevicesMutex.unlock();

        if (!found)
            return false;

        Helpers::StoredIoDevice stored;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, stored) != ESP_OK)
            return false;
        stored.quiet = quiet;
        esp_err_t err = Helpers::DeviceStorage::SaveIoDevice(deviceID, stored);
        if (err == ESP_OK)
            ESP_LOGI(TAG, "Quiet mode for %s set to %s", deviceID.c_str(), quiet ? "on" : "off");
        return err == ESP_OK;
    }

    bool IoRtsManager::SetLocalName(const std::string &deviceID, const std::string &name)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool found = it != mIoDevices.end();
        if (found) {
            strncpy(it->second.local_name, name.c_str(), sizeof(it->second.local_name) - 1);
            it->second.local_name[sizeof(it->second.local_name) - 1] = '\0';
        }
        mIoDevicesMutex.unlock();

        if (!found)
            return false;

        Helpers::StoredIoDevice stored;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, stored) != ESP_OK)
            return false;
        stored.local_name = name;
        esp_err_t err = Helpers::DeviceStorage::SaveIoDevice(deviceID, stored);
        if (err == ESP_OK)
        {
            ESP_LOGI(TAG, "Local name for %s set to '%s'", deviceID.c_str(), name.c_str());
            if (sMqttHelper != nullptr)
                sMqttHelper->SendDiscovery();
        }
        return err == ESP_OK;
    }

    void IoRtsManager::StartKeySniff()
    {
        if (mIoHome != nullptr)
            mIoHome->StartKeySniff();
    }

    void IoRtsManager::StopKeySniff()
    {
        if (mIoHome != nullptr)
            mIoHome->StopKeySniff();
    }

    bool IoRtsManager::IsKeySniffActive() const
    {
        return mIoHome != nullptr && mIoHome->IsKeySniffActive();
    }

    std::string IoRtsManager::GetSniffedKey() const
    {
        if (mIoHome == nullptr) return {};
        return mIoHome->GetSniffedKey();
    }

    bool IoRtsManager::GetMqttConnected() const
    {
        return sMqttHelper != nullptr && sMqttHelper->IsMqttConnected();
    }

    const char *IoRtsManager::GetMqttStatusString() const
    {
        if (sMqttHelper == nullptr) return "disabled";
        return sMqttHelper->GetMqttStatusString();
    }

    void IoRtsManager::TriggerMqttStart()
    {
        if (sMqttHelper != nullptr)
            sMqttHelper->StartMqttClient();
    }

    void IoRtsManager::TriggerMqttRestart()
    {
        if (sMqttHelper != nullptr)
            sMqttHelper->RestartMqttClient();
    }

    void IoRtsManager::InitializeIo()
    {
        mIoPassive = IoHomeConfig::isPassiveModeEnabled();

        // Initialize IO-HOMECONTROL
        mSX1276Radio = new RadioLinks::RadioSX1276(Config::GetSX1276SpiHost(),
                                                   CONFIG_IOHOMECONTROL_SX1276_SPI_CS, CONFIG_IOHOMECONTROL_SX1276_RST,
                                                   CONFIG_IOHOMECONTROL_SX1276_DIO0, CONFIG_IOHOMECONTROL_SX1276_DIO2, CONFIG_IOHOMECONTROL_SX1276_DIO4);
        if (mSX1276Radio != nullptr)
        {
            mIoHome = new iohome::IoHomeControl(mSX1276Radio, loggerCallback, deviceStatusCallback);
            if (mIoHome != nullptr)
            {
                mIoHome->SetVerbose(IoHomeConfig::isLoggingEnabled());
                mIoHome->SetIgnoreAutoUpdate(IoHomeConfig::isIgnoreAutoUpdateEnabled());
                mIoHome->Begin(IoHomeConfig::GetIoNodeId(), IoHomeConfig::GetIoSystemKey(), IoHomeConfig::isPassiveModeEnabled());
                mIoHome->ConfigureRadio(IoHomeConfig::GetTxPower());
                mIo1W = new iohome::Io1WControl(mIoHome);
                mIoHome->SetUnknownSenderCallback(unknownSenderCallback);
                mIoHome->SetKeySniffCallback(keySniffCallback);
                mIoHome->SetMovementStartedCallback([](const std::string &deviceID, uint32_t transit_ms, float dist) {
                    if (sIoRtsManager)
                        sIoRtsManager->ScheduleConfirmationPoll(deviceID, transit_ms, dist);
                });
            }
        }
    }
    void IoRtsManager::InitializeMqtt()
    {
        if (MqttConfig::isEnabled())
        {
            // Create MQTT helper
            sMqttHelper = new MqttHelpers(this);
        }
        else
        {
            sMqttHelper = nullptr;
        }
    }

    // =========================================================================
    // Unified command dispatch (2W and 1W)
    // =========================================================================

    bool IoRtsManager::OpenDevice(const std::string &deviceID, bool quiet)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool is1w = (it != mIoDevices.end() && it->second.info.protocol_mode == iohome::ProtocolMode::PROTO_1W);
        mIoDevicesMutex.unlock();

        if (is1w && mIo1W)
        {
            mIoDevicesMutex.lock();
            bool ok = mIo1W->Send(mIoDevices.at(deviceID).info, 0.0f);
            mIoDevicesMutex.unlock();
            if (ok) SaveDevice1WSequence(deviceID);
            return ok;
        }
        return mIoHome->OpenDevice(deviceID, quiet);
    }

    bool IoRtsManager::CloseDevice(const std::string &deviceID, bool quiet)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool is1w = (it != mIoDevices.end() && it->second.info.protocol_mode == iohome::ProtocolMode::PROTO_1W);
        mIoDevicesMutex.unlock();

        if (is1w && mIo1W)
        {
            mIoDevicesMutex.lock();
            bool ok = mIo1W->Send(mIoDevices.at(deviceID).info, 100.0f);
            mIoDevicesMutex.unlock();
            if (ok) SaveDevice1WSequence(deviceID);
            return ok;
        }
        return mIoHome->CloseDevice(deviceID, quiet);
    }

    bool IoRtsManager::SetDevicePosition(const std::string &deviceID, uint8_t position, bool quiet)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool is1w = (it != mIoDevices.end() && it->second.info.protocol_mode == iohome::ProtocolMode::PROTO_1W);
        mIoDevicesMutex.unlock();

        if (is1w && mIo1W)
        {
            mIoDevicesMutex.lock();
            bool ok = mIo1W->Send(mIoDevices.at(deviceID).info, (float)position);
            mIoDevicesMutex.unlock();
            if (ok) SaveDevice1WSequence(deviceID);
            return ok;
        }
        return mIoHome->SetDevicePosition(deviceID, position, quiet);
    }

    bool IoRtsManager::StopDevice(const std::string &deviceID)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        bool is1w = (it != mIoDevices.end() && it->second.info.protocol_mode == iohome::ProtocolMode::PROTO_1W);
        float cur_pos = (it != mIoDevices.end()) ? it->second.position : 0.0f;
        mIoDevicesMutex.unlock();

        if (is1w && mIo1W)
        {
            mIoDevicesMutex.lock();
            bool ok = mIo1W->Stop(mIoDevices.at(deviceID).info);
            mIoDevicesMutex.unlock();
            if (ok) SaveDevice1WSequence(deviceID);
            return ok;
        }
        return mIoHome->StopDevice(deviceID);
    }

    void IoRtsManager::StartMoveTracking(const std::string &deviceID, float target_pos)
    {
        std::lock_guard<std::mutex> guard(mIoDevicesMutex);
        auto it = mIoDevices.find(deviceID);
        if (it == mIoDevices.end()) return;
        float cur = it->second.position;
        if (cur == iohome::UNKNOWN_POSITION)
            cur = (target_pos <= 50.0f) ? 100.0f : 0.0f;
        if (std::abs(cur - target_pos) > 1.0f) {
            it->second.move_start_us   = esp_timer_get_time();
            it->second.move_start_pos  = cur;
            it->second.move_target_pos = target_pos;
        }
    }

    void IoRtsManager::StopMoveTracking(const std::string &deviceID)
    {
        std::lock_guard<std::mutex> guard(mIoDevicesMutex);
        auto it = mIoDevices.find(deviceID);
        if (it != mIoDevices.end()) it->second.move_start_us = 0;
    }

    void IoRtsManager::SaveDevice1WSequence(const std::string &deviceID)
    {
        // Read-modify-write: load the full StoredIoDevice from flash to preserve
        // linked_remotes, quiet, transit_time_ms, then patch sequence_1w.
        Helpers::StoredIoDevice sd;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, sd) != ESP_OK) return;
        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it != mIoDevices.end())
                sd.device.info.sequence_1w = it->second.info.sequence_1w;
        }
        Helpers::DeviceStorage::SaveIoDevice(deviceID, sd);
    }

    std::string IoRtsManager::Pair1WDevice(const std::string &name, iohome::DeviceType type, iohome::Manufacturer manufacturer)
    {
        if (!mIo1W) return "";

        uint8_t rand_id[3];
        esp_fill_random(rand_id, 3);
        char id_str[7];
        snprintf(id_str, sizeof(id_str), "%02X%02X%02X", rand_id[0], rand_id[1], rand_id[2]);

        iohome::IoDeviceInformation info = {};
        info.protocol_mode = iohome::ProtocolMode::PROTO_1W;
        memcpy(info.node_id, rand_id, iohome::NODE_ID_SIZE);
        strncpy(info.name, name.c_str(), sizeof(info.name) - 1);
        info.device_type  = type;
        info.manufacturer = manufacturer;

        if (!mIo1W->PairDevice(info))
        {
            ESP_LOGE("IoRtsManager", "Pair1WDevice: radio TX failed");
            return "";
        }

        iohome::IoDevice dev = {};
        dev.info            = info;
        dev.position        = iohome::UNKNOWN_POSITION;
        dev.target          = iohome::UNKNOWN_POSITION;
        dev.tilt            = iohome::UNKNOWN_POSITION;
        dev.is_stopped      = true;
        dev.transit_time_ms = 0;

        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            mIoDevices[id_str] = dev;
        }

        Helpers::StoredIoDevice sd;
        sd.device = dev;
        Helpers::DeviceStorage::SaveIoDevice(id_str, sd);

        ESP_LOGI("IoRtsManager", "Pair1WDevice: paired '%s' as %s", name.c_str(), id_str);
        return id_str;
    }

    bool IoRtsManager::ReSendPair1W(const std::string &deviceID)
    {
        if (!mIo1W) return false;

        iohome::IoDeviceInformation snap;
        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it == mIoDevices.end() || it->second.info.protocol_mode != iohome::ProtocolMode::PROTO_1W)
                return false;
            snap = it->second.info;
        }

        bool ok = mIo1W->ReSendPair(snap);

        if (ok) {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it != mIoDevices.end())
                it->second.info.sequence_1w = snap.sequence_1w;
        }
        if (ok) SaveDevice1WSequence(deviceID);
        return ok;
    }

    bool IoRtsManager::Wink1WDevice(const std::string &deviceID)
    {
        if (!mIo1W) return false;

        iohome::IoDeviceInformation snap;
        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it == mIoDevices.end() || it->second.info.protocol_mode != iohome::ProtocolMode::PROTO_1W)
                return false;
            snap = it->second.info;
        }

        bool ok = mIo1W->WinkDevice(snap);

        if (ok) {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it != mIoDevices.end())
                it->second.info.sequence_1w = snap.sequence_1w;
        }
        if (ok) SaveDevice1WSequence(deviceID);
        return ok;
    }

    bool IoRtsManager::SendRemove1W(const std::string &deviceID)
    {
        if (!mIo1W) return false;

        iohome::IoDeviceInformation snap;
        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it == mIoDevices.end() || it->second.info.protocol_mode != iohome::ProtocolMode::PROTO_1W)
                return false;
            snap = it->second.info;
        }

        bool ok = mIo1W->UnpairDevice(snap);

        if (ok) {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            auto it = mIoDevices.find(deviceID);
            if (it != mIoDevices.end())
                it->second.info.sequence_1w = snap.sequence_1w;
        }
        if (ok) SaveDevice1WSequence(deviceID);
        return ok;
    }

    bool IoRtsManager::Unpair1WDevice(const std::string &deviceID)
    {
        mIoDevicesMutex.lock();
        auto it = mIoDevices.find(deviceID);
        if (it == mIoDevices.end() || it->second.info.protocol_mode != iohome::ProtocolMode::PROTO_1W)
        {
            mIoDevicesMutex.unlock();
            return false;
        }
        iohome::IoDeviceInformation info = it->second.info;
        mIoDevicesMutex.unlock();

        if (mIo1W) mIo1W->UnpairDevice(info);

        {
            std::lock_guard<std::mutex> lock(mIoDevicesMutex);
            mIoDevices.erase(deviceID);
        }
        Helpers::DeviceStorage::RemoveIoDevice(deviceID);
        return true;
    }

    extern "C" bool oled_mqtt_connected(void)
    {
        return sMqttHelper != nullptr && sMqttHelper->IsMqttConnected();
    }
}
