#include "MqttHelpers.hpp"
#include "MqttConfig.hpp"
#include "IoHomeConfig.hpp"
#include "DeviceStorage.hpp"
#include "NetworkHelpers.hpp"

#include <algorithm>
#include <vector>
#include <deque>
#include <cinttypes>

#include "cJSON.h"

#include "esp_app_desc.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"

#ifdef CONFIG_CONNECTIVITY_CHOICE_WIFI
#include "esp_wifi.h"
#endif
#ifdef CONFIG_CONNECTIVITY_CHOICE_ETH
#include "esp_eth.h"
#endif

using namespace Config;
using namespace iohome;

static const std::string MQTT_CERTIFICATE_BEGIN = "-----BEGIN CERTIFICATE-----\n";
static const std::string MQTT_CERTIFICATE_END = "\n-----END CERTIFICATE-----";
static const std::string MQTT_CLIENT_COMMAND_TOPIC = "/set";                   // command topic
static const std::string MQTT_CLIENT_COMMAND_POSITION_TOPIC = "/set_position"; // position topic
static const std::string MQTT_CLIENT_COMMAND_TILT_TOPIC = "/set_tilt";         // tilt topic
static const std::string MQTT_CLIENT_COMMAND_FAV_POS_TOPIC = "/set_fav_pos";   // set favorite position topic
static const std::string MQTT_CLIENT_STATE_TOPIC = "/state";                   // state topic
static const std::string MQTT_CLIENT_POSITION_TOPIC = "/position";             // position topic
static const std::string MQTT_CLIENT_TILT_TOPIC = "/tilt";                     // tilt topic
static const std::string MQTT_CLIENT_DISCOVERY_TOPIC = "/config";              // discovery topic

static const std::string MQTT_CLIENT_REBOOT_ID = "button_reboot";     // unique id and topic for "reboot" button
static const std::string MQTT_CLIENT_DISCOVER_ID = "button_discover"; // unique id and topic for "Discover" button

static const std::string MQTT_CLIENT_CONFIG_IO_ID = "config_io";   // topic for IO layer configuration components
static const std::string MQTT_CLIENT_IO_LOGGING_ID = "IoLogging";  // unique id and action for "IoLogging" component
static const std::string MQTT_CLIENT_IO_PASSIVE_ID = "IoPassive";  // unique id and action for "IoPassive" component
static const std::string MQTT_CLIENT_IO_TX_POWER_ID = "IoTxPower"; // unique id and action for "IoTxPower" component

static const std::string MQTT_CLIENT_MANAGE_IO_ID = "manage_io";               // topic for IO devices management components
static const std::string MQTT_CLIENT_ADD_DEVICE_ID = "AddIoDevice";            // unique id and action for "AddDevice" component
static const std::string MQTT_CLIENT_REM_DEVICE_ID = "RemoveIoDevice";         // backwards compat — maps to deactivate (not in discovery)
static const std::string MQTT_CLIENT_DEACT_DEVICE_ID = "DeactivateIoDevice";   // unique id for deactivate select entity
static const std::string MQTT_CLIENT_DEACT_SELECT_TOPIC = "deactivate_select"; // topic segment for the deactivate select entity
static const std::string MQTT_CLIENT_DEL_DEVICE_ID = "DeleteIoDevice";         // unique id and action for "DeleteDevice" text input
static const std::string MQTT_CLIENT_REACT_SELECT_ID = "ReactivateIoDevice";   // unique id for reactivate select entity
static const std::string MQTT_CLIENT_REACT_SELECT_TOPIC = "reactivate_select"; // topic segment for the reactivate select entity
static const std::string MQTT_CLIENT_INACTIVE_DEVICES_ID = "inactive_devices"; // unique id for inactive devices sensor

static const std::string MQTT_CLIENT_PREFIX_IO = "io_";          // unique_id prefix for IO devices
static const std::string MQTT_CLIENT_SUFFIX_FAV_IO = "_fav";     // unique_id suffix for IO devices "favorite" button
static const std::string MQTT_CLIENT_SUFFIX_IDENTIFY = "_ident"; // unique_id suffix for IO devices "identify" button
static const std::string MQTT_CLIENT_SUFFIX_MANAGE = "_manage";  // per-device manage command topic suffix
static const std::string MQTT_CLIENT_SUFFIX_REMOTES = "_remotes"; // per-device remotes sensor topic suffix
static const std::string MQTT_CLIENT_SUFFIX_TRANSIT = "_transit"; // per-device transit time number topic suffix

static const std::string MQTT_CLIENT_BIRTH_WILL_TOPIC = "/status"; // birth and last will topic
static const std::string MQTT_CLIENT_BIRTH_MSG = "online";         // last will message - birth
static const std::string MQTT_CLIENT_WILL_MSG = "offline";         // last will message - death

static const std::string MQTT_CLIENT_LOG_TOPIC = "/log"; // log topic

static const char *TAG = "MQTTHelper";

// Depth of mCommandQueue. Commands are executed serially over RF (~1 s each), so group
// actions (e.g. "all lights off" in Home Assistant) burst one command per device at once.
static constexpr UBaseType_t MQTT_CMD_QUEUE_DEPTH = 64;

// While draining a burst the worker holds IoHomeControl status polls back, so every command goes
// out before the radio is spent on status polls. After the last command it waits this long for a
// straggler before releasing the hold.
static constexpr TickType_t MQTT_CMD_BURST_GRACE_MS = 250;

// A command the device did not authenticate (radio exchange failed after all SendAndReceive
// attempts) goes to the back of the line and is sent again, at most this many times.
static constexpr uint8_t MQTT_CMD_MAX_REQUEUES = 2;

// Minimum delay before a requeued command is sent again. Fresh commands still go first; this only
// matters when the requeued command is the last one left, so it doesn't hit a busy channel at once.
static constexpr TickType_t MQTT_CMD_REQUEUE_DELAY_MS = 1000;

// "Queue full" drops are logged at most once per this interval; the rest are counted into the next
// line so a flood of commands can't flood syslog as well.
static constexpr int64_t MQTT_CMD_DROP_LOG_INTERVAL_US = 1'000'000;

// Command packet sent through mCommandQueue — keeps the MQTT callback non-blocking.
struct MqttCmd {
    char    device_id[7]; // 6 hex chars + null terminator
    Helpers::MqttHelpers::MqttCmdType type;
    float   value;        // used for POSITION and TILT commands
    uint8_t requeues;     // times this command has been sent to the back of the line after failing
};

namespace Helpers
{
    static void mqtt_reconnect_timer_cb(void *arg)
    {
        static_cast<MqttHelpers *>(arg)->OnNetworkConnected();
    }

    static void mqtt_network_event_handler(void *handler_args, esp_event_base_t event_base,
                                           int32_t event_id, void *event_data)
    {
        MqttHelpers *mqttHelper = static_cast<MqttHelpers *>(handler_args);
#ifdef CONFIG_CONNECTIVITY_CHOICE_WIFI
        if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED)
            mqttHelper->OnNetworkDisconnected();
        else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP)
            mqttHelper->OnNetworkConnected();
#endif
#ifdef CONFIG_CONNECTIVITY_CHOICE_ETH
        if (event_base == ETH_EVENT && event_id == ETHERNET_EVENT_DISCONNECTED)
            mqttHelper->OnNetworkDisconnected();
        else if (event_base == IP_EVENT && event_id == IP_EVENT_ETH_GOT_IP)
            mqttHelper->OnNetworkConnected();
#endif
    }

    /// @brief Event handler registered to receive MQTT events
    /// @param handler_args user data registered to the event => MqttHelpers object
    /// @param base Event base for the handler(always MQTT Base)
    /// @param event_id The id for the received event.
    /// @param event_data The data for the event, esp_mqtt_event_handle_t
    static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
    {
        ESP_LOGD(TAG, "Event dispatched from event loop base=%s, event_id=%" PRIi32, base, event_id);
        MqttHelpers *mqttHelper = static_cast<MqttHelpers *>(handler_args);
        IoRts::IoRtsManager *mgr = mqttHelper->GetIoRtsManager();
        esp_mqtt_event_handle_t event = static_cast<esp_mqtt_event_handle_t>(event_data);
        esp_mqtt_client_handle_t client = event->client;
        int msg_id;
        switch ((esp_mqtt_event_id_t)event_id)
        {
        case MQTT_EVENT_CONNECTED:
        {
            ESP_LOGI(TAG, "MQTT_EVENT_CONNECTED");
            mqttHelper->OnMqttConnected();
            // send birth message
            std::string topic = mqttHelper->GetTopicPrefix() + MQTT_CLIENT_BIRTH_WILL_TOPIC;
            const char *data = MQTT_CLIENT_BIRTH_MSG.c_str();
            msg_id = esp_mqtt_client_publish(client, topic.c_str(), data, 0, 0, 1);
            ESP_LOGD(TAG, "sent publish successful, msg_id=%d", msg_id);
            // Send current IO config (logging, passive mode, Tx power)
            topic = mqttHelper->GetTopicPrefix() + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_STATE_TOPIC;
            cJSON *ioConfig = cJSON_CreateObject();
            if (ioConfig != NULL)
            {
                bool error = false;
                std::string logging = IoHomeConfig::isLoggingEnabled() ? "ON" : "OFF";
                std::string passive = IoHomeConfig::isPassiveModeEnabled() ? "ON" : "OFF";
                error = error || (cJSON_AddStringToObject(ioConfig, MQTT_CLIENT_IO_LOGGING_ID.c_str(), logging.c_str()) == NULL);             // IoLogging
                error = error || (cJSON_AddStringToObject(ioConfig, MQTT_CLIENT_IO_PASSIVE_ID.c_str(), passive.c_str()) == NULL);             // IoPassive
                error = error || (cJSON_AddNumberToObject(ioConfig, MQTT_CLIENT_IO_TX_POWER_ID.c_str(), IoHomeConfig::GetTxPower()) == NULL); // IoTxPower
                const char *config = cJSON_Print(ioConfig);
                esp_mqtt_client_publish(client, topic.c_str(), config, 0, 0, 1);
                cJSON_free((void *)config);
                cJSON_Delete(ioConfig);
            }
            // Send discovery
            mqttHelper->SendDiscovery();
            // Publish inactive devices list so HA sensor and select are up to date
            mqttHelper->PublishInactiveDevicesList();
            // Publish linked remotes sensor for each active device — load storage once for all
            {
                std::vector<std::string> activeIDs;
                {
                    std::lock_guard<std::mutex> guard(mgr->mIoDevicesMutex);
                    for (const auto &[id, dev] : mgr->mIoDevices)
                        if (!dev.is_deleted)
                            activeIDs.push_back(id);
                }
                std::map<std::string, Helpers::StoredIoDevice> allStored;
                Helpers::DeviceStorage::LoadAllIoDevices(allStored);
                for (const std::string &id : activeIDs)
                {
                    auto it = allStored.find(id);
                    if (it != allStored.end())
                        mqttHelper->PublishDeviceRemotesList(id, it->second);
                    else
                        mqttHelper->PublishDeviceRemotesList(id);
                }
            }
            // Re-publish current state of all locally known devices so HA is immediately up-to-date
            {
                std::vector<std::string> activeIDs;
                {
                    std::lock_guard<std::mutex> guard(mgr->mIoDevicesMutex);
                    for (const auto &[id, dev] : mgr->mIoDevices)
                        activeIDs.push_back(id);
                }
                for (const std::string &id : activeIDs)
                    mqttHelper->SendIoDeviceStatus(id);
            }
            // subscribe to all command topics
            topic = mqttHelper->GetTopicPrefix() + "/+" + MQTT_CLIENT_COMMAND_TOPIC;
            msg_id = esp_mqtt_client_subscribe(client, topic.c_str(), 0);
            topic = mqttHelper->GetTopicPrefix() + "/+" + MQTT_CLIENT_COMMAND_POSITION_TOPIC;
            msg_id = esp_mqtt_client_subscribe(client, topic.c_str(), 0);
            topic = mqttHelper->GetTopicPrefix() + "/+" + MQTT_CLIENT_COMMAND_FAV_POS_TOPIC;
            msg_id = esp_mqtt_client_subscribe(client, topic.c_str(), 0);
            topic = mqttHelper->GetTopicPrefix() + "/+" + MQTT_CLIENT_COMMAND_TILT_TOPIC;
            msg_id = esp_mqtt_client_subscribe(client, topic.c_str(), 0);
            break;
        }
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTT_EVENT_DISCONNECTED");
            mqttHelper->OnMqttDisconnected();
            break;

        case MQTT_EVENT_SUBSCRIBED:
            // ESP_LOGI(TAG, "MQTT_EVENT_SUBSCRIBED, msg_id=%d, return code=0x%02x ", event->msg_id, (uint8_t)*event->data);
            break;
        case MQTT_EVENT_UNSUBSCRIBED:
            // ESP_LOGI(TAG, "MQTT_EVENT_UNSUBSCRIBED, msg_id=%d", event->msg_id);
            break;
        case MQTT_EVENT_PUBLISHED:
            // ESP_LOGI(TAG, "MQTT_EVENT_PUBLISHED, msg_id=%d", event->msg_id);
            break;
        case MQTT_EVENT_DATA:
        {
            // ESP_LOGI(TAG, "MQTT_EVENT_DATA");
            // ESP_LOGI(TAG, "TOPIC=%.*s\r\n", event->topic_len, event->topic);
            // ESP_LOGI(TAG, "DATA=%.*s\r\n", event->data_len, event->data);
            // Parse command and do the job!
            // Is it a command for us?
            const std::string topic_str(event->topic, event->topic_len);
            if (topic_str.starts_with(mqttHelper->GetTopicPrefix()) &&
                (topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC) || topic_str.ends_with(MQTT_CLIENT_COMMAND_POSITION_TOPIC) || topic_str.ends_with(MQTT_CLIENT_COMMAND_FAV_POS_TOPIC) || topic_str.ends_with(MQTT_CLIENT_COMMAND_TILT_TOPIC)))
            {
                size_t id_len = 0;
                if (topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    id_len = topic_str.length() - mqttHelper->GetTopicPrefix().length() - MQTT_CLIENT_COMMAND_TOPIC.length() - 1;
                else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_POSITION_TOPIC))
                    id_len = topic_str.length() - mqttHelper->GetTopicPrefix().length() - MQTT_CLIENT_COMMAND_POSITION_TOPIC.length() - 1;
                else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_FAV_POS_TOPIC))
                    id_len = topic_str.length() - mqttHelper->GetTopicPrefix().length() - MQTT_CLIENT_COMMAND_FAV_POS_TOPIC.length() - 1;
                else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_TILT_TOPIC))
                    id_len = topic_str.length() - mqttHelper->GetTopicPrefix().length() - MQTT_CLIENT_COMMAND_TILT_TOPIC.length() - 1;
                if (id_len > 0)
                {
                    std::string entity_id = topic_str.substr(mqttHelper->GetTopicPrefix().length() + 1, id_len);
                    if (entity_id.compare(MQTT_CLIENT_REBOOT_ID) == 0)
                    {
                        ESP_LOGI(TAG, "REBOOT requested from MQTT!");
                        mgr->Reboot();
                    }
                    else if (entity_id.compare(MQTT_CLIENT_CONFIG_IO_ID) == 0 && topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    {
                        ESP_LOGI(TAG, "IO CONFIG requested from MQTT!");
                        // Let's parse the JSON
                        char *buf = new char[event->data_len + 1];
                        memcpy(buf, event->data, event->data_len);
                        buf[event->data_len] = '\0';
                        cJSON *root = cJSON_Parse(buf);
                        delete[] buf;
                        if (root == nullptr)
                        {
                            ESP_LOGE(TAG, "Failed to parse JSON from IO CONFIG requested from MQTT!");
                            break;
                        }
                        // Let's check what we have to do
                        cJSON *loggingItem = cJSON_GetObjectItem(root, MQTT_CLIENT_IO_LOGGING_ID.c_str());
                        if (cJSON_IsString(loggingItem))
                        {
                            std::string value(loggingItem->valuestring);
                            if (value.compare("ON") == 0)
                            {
                                IoHomeConfig::ActivateLogging(true);
                            }
                            else if (value.compare("OFF") == 0)
                            {
                                IoHomeConfig::ActivateLogging(false);
                            }
                        }
                        cJSON *passiveItem = cJSON_GetObjectItem(root, MQTT_CLIENT_IO_PASSIVE_ID.c_str());
                        if (cJSON_IsString(passiveItem))
                        {
                            std::string value(passiveItem->valuestring);
                            if (value.compare("ON") == 0)
                            {
                                IoHomeConfig::ActivatePassiveMode(true);
                            }
                            else if (value.compare("OFF") == 0)
                            {
                                IoHomeConfig::ActivatePassiveMode(false);
                            }
                        }
                        cJSON *txPowerItem = cJSON_GetObjectItem(root, MQTT_CLIENT_IO_TX_POWER_ID.c_str());
                        if (cJSON_IsNumber(txPowerItem))
                        {
                            IoHomeConfig::SetTxPower(cJSON_GetNumberValue(txPowerItem));
                        }
                        // Don't forget to delete JSON object to free memory!
                        cJSON_Delete(root);
                    }
                    else if (entity_id.compare(MQTT_CLIENT_MANAGE_IO_ID) == 0 && topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    {
                        ESP_LOGI(TAG, "IO MANAGE requested from MQTT!");
                        // Let's parse the JSON
                        char *buf = new char[event->data_len + 1];
                        memcpy(buf, event->data, event->data_len);
                        buf[event->data_len] = '\0';
                        cJSON *root = cJSON_Parse(buf);
                        delete[] buf;
                        if (root == nullptr)
                        {
                            ESP_LOGE(TAG, "Failed to parse JSON from IO MANAGE requested from MQTT!");
                            break;
                        }
                        // Let's check what we have to do
                        cJSON *addDeviceItem = cJSON_GetObjectItem(root, MQTT_CLIENT_ADD_DEVICE_ID.c_str());
                        if (cJSON_IsString(addDeviceItem))
                        {
                            std::string deviceID(addDeviceItem->valuestring);
                            if (deviceID.length() == NODE_ID_SIZE * 2)
                            {
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); }); // convert to uppercase
                                mgr->mIoHome->AddDevice(deviceID);
                            }
                        }
                        // RemoveIoDevice kept for backwards compat — maps to deactivate
                        cJSON *removeDeviceItem = cJSON_GetObjectItem(root, MQTT_CLIENT_REM_DEVICE_ID.c_str());
                        if (cJSON_IsString(removeDeviceItem))
                        {
                            std::string deviceID(removeDeviceItem->valuestring);
                            if (deviceID.length() == NODE_ID_SIZE * 2)
                            {
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); });
                                mgr->DeactivateDevice(deviceID);
                            }
                        }
                        cJSON *deactDeviceItem = cJSON_GetObjectItem(root, MQTT_CLIENT_DEACT_DEVICE_ID.c_str());
                        if (cJSON_IsString(deactDeviceItem))
                        {
                            std::string deviceID(deactDeviceItem->valuestring);
                            if (deviceID.length() == NODE_ID_SIZE * 2)
                            {
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); });
                                mgr->DeactivateDevice(deviceID);
                            }
                        }
                        cJSON *delDeviceItem = cJSON_GetObjectItem(root, MQTT_CLIENT_DEL_DEVICE_ID.c_str());
                        if (cJSON_IsString(delDeviceItem))
                        {
                            std::string data(delDeviceItem->valuestring);
                            // Requires "<deviceID>:CONFIRM" to prevent accidental permanent deletion
                            if (data.length() == NODE_ID_SIZE * 2 + 8 && data.substr(NODE_ID_SIZE * 2) == ":CONFIRM")
                            {
                                std::string deviceID = data.substr(0, NODE_ID_SIZE * 2);
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); });
                                mgr->DeleteDevice(deviceID);
                            }
                            else
                            {
                                ESP_LOGW(TAG, "DeleteIoDevice: requires <ID>:CONFIRM format, got: %s", data.c_str());
                            }
                        }
                        // Don't forget to delete JSON object to free memory!
                        cJSON_Delete(root);
                    }
                    else if (entity_id.compare(MQTT_CLIENT_DISCOVER_ID) == 0)
                    {
                        if (mqttHelper->isIoHomePassive())
                            break; // don't process IO devices commands if in passive mode
                        ESP_LOGI(TAG, "DISCOVER requested from MQTT!");
                        mgr->mIoHome->DiscoverAndPairDevice();
                    }
                    else if (entity_id.compare(MQTT_CLIENT_DEACT_SELECT_TOPIC) == 0 && topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    {
                        // Deactivate select: payload is "Name (AABBCC)" or "— none —"
                        const std::string selection(event->data, event->data_len);
                        auto openParen = selection.rfind('(');
                        auto closeParen = selection.rfind(')');
                        if (openParen != std::string::npos && closeParen != std::string::npos && closeParen > openParen)
                        {
                            std::string deviceID = selection.substr(openParen + 1, closeParen - openParen - 1);
                            if (deviceID.length() == NODE_ID_SIZE * 2)
                            {
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); });
                                ESP_LOGI(TAG, "DeactivateDevice from select: %s", deviceID.c_str());
                                mgr->DeactivateDevice(deviceID);
                                // Reset deactivate select state to placeholder
                                std::string state_topic = mqttHelper->GetTopicPrefix() + "/" + MQTT_CLIENT_DEACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
                                esp_mqtt_client_publish(client, state_topic.c_str(), "— none —", 0, 0, 0);
                            }
                        }
                    }
                    else if (entity_id.compare(MQTT_CLIENT_REACT_SELECT_TOPIC) == 0 && topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    {
                        // Reactivate select: payload is "Name (AABBCC)" or "— none —"
                        const std::string selection(event->data, event->data_len);
                        auto openParen = selection.rfind('(');
                        auto closeParen = selection.rfind(')');
                        if (openParen != std::string::npos && closeParen != std::string::npos && closeParen > openParen)
                        {
                            std::string deviceID = selection.substr(openParen + 1, closeParen - openParen - 1);
                            if (deviceID.length() == NODE_ID_SIZE * 2)
                            {
                                std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                               { return std::toupper(c); });
                                ESP_LOGI(TAG, "ReactivateDevice from select: %s", deviceID.c_str());
                                mgr->ReactivateDevice(deviceID);
                                // Publish updated state back to the select (reset to placeholder)
                                std::string state_topic = mqttHelper->GetTopicPrefix() + "/" + MQTT_CLIENT_REACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
                                esp_mqtt_client_publish(client, state_topic.c_str(), "— none —", 0, 0, 0);
                            }
                        }
                    }
                    else if (entity_id.starts_with(MQTT_CLIENT_PREFIX_IO) &&
                             entity_id.length() > MQTT_CLIENT_PREFIX_IO.length() + MQTT_CLIENT_SUFFIX_MANAGE.length() &&
                             entity_id.ends_with(MQTT_CLIENT_SUFFIX_MANAGE) &&
                             topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                    {
                        if (mqttHelper->isIoHomePassive())
                            break;
                        // Extract device ID — strip "io_" prefix and "_manage" suffix
                        std::string deviceID = entity_id.substr(
                            MQTT_CLIENT_PREFIX_IO.length(),
                            entity_id.length() - MQTT_CLIENT_PREFIX_IO.length() - MQTT_CLIENT_SUFFIX_MANAGE.length());
                        if (deviceID.length() != NODE_ID_SIZE * 2)
                        {
                            ESP_LOGE(TAG, "Per-device manage: invalid device ID '%s'", deviceID.c_str());
                            break;
                        }
                        std::transform(deviceID.begin(), deviceID.end(), deviceID.begin(), [](unsigned char c)
                                       { return std::toupper(c); });
                        char *buf = new char[event->data_len + 1];
                        memcpy(buf, event->data, event->data_len);
                        buf[event->data_len] = '\0';
                        cJSON *root = cJSON_Parse(buf);
                        delete[] buf;
                        if (root == nullptr)
                        {
                            ESP_LOGE(TAG, "Per-device manage: failed to parse JSON for %s", deviceID.c_str());
                            break;
                        }
                        cJSON *actionItem = cJSON_GetObjectItem(root, "action");
                        cJSON *valueItem = cJSON_GetObjectItem(root, "value");
                        if (cJSON_IsString(actionItem))
                        {
                            std::string action(actionItem->valuestring);
                            if (action == "rename" && cJSON_IsString(valueItem))
                            {
                                std::string newName(valueItem->valuestring);
                                ESP_LOGI(TAG, "Per-device manage: rename %s -> '%s'", deviceID.c_str(), newName.c_str());
                                mgr->mIoHome->SetDeviceName(deviceID, newName);
                            }
                            else if (action == "deactivate")
                            {
                                ESP_LOGI(TAG, "Per-device manage: deactivate %s", deviceID.c_str());
                                mgr->DeactivateDevice(deviceID);
                            }
                            else if (action == "invert")
                            {
                                ESP_LOGI(TAG, "Per-device manage: invert %s", deviceID.c_str());
                                mgr->mIoHome->InvertOpenClosePositionForDevice(deviceID);
                                mqttHelper->SendDiscovery(); // refresh discovery so position_open/closed swaps
                            }
                            else if (action == "link_remote" && cJSON_IsString(valueItem))
                            {
                                std::string remoteID(valueItem->valuestring);
                                if (remoteID.length() == NODE_ID_SIZE * 2)
                                {
                                    std::transform(remoteID.begin(), remoteID.end(), remoteID.begin(), [](unsigned char c)
                                                   { return std::toupper(c); });
                                    ESP_LOGI(TAG, "Per-device manage: link remote %s -> device %s", remoteID.c_str(), deviceID.c_str());
                                    mgr->LinkRemoteToDevice(remoteID, deviceID);
                                }
                            }
                            else if (action == "remove_remote" && cJSON_IsString(valueItem))
                            {
                                std::string remoteID(valueItem->valuestring);
                                if (remoteID.length() == NODE_ID_SIZE * 2)
                                {
                                    std::transform(remoteID.begin(), remoteID.end(), remoteID.begin(), [](unsigned char c)
                                                   { return std::toupper(c); });
                                    ESP_LOGI(TAG, "Per-device manage: remove remote %s", remoteID.c_str());
                                    mgr->RemoveIoRemote(remoteID);
                                }
                            }
                            else if (action == "set_transit_time" && cJSON_IsNumber(valueItem))
                            {
                                uint32_t transitMs = (uint32_t)(valueItem->valuedouble * 1000);
                                ESP_LOGI(TAG, "Per-device manage: set transit time %s -> %ums", deviceID.c_str(), transitMs);
                                if (mgr->SetTransitTime(deviceID, transitMs))
                                    mqttHelper->SendIoDeviceStatus(deviceID); // publish updated value
                            }
                            else
                            {
                                ESP_LOGW(TAG, "Per-device manage: unknown action '%s' for %s", action.c_str(), deviceID.c_str());
                            }
                        }
                        cJSON_Delete(root);
                    }
                    else if (entity_id.starts_with(MQTT_CLIENT_PREFIX_IO))
                    {
                        if (mqttHelper->isIoHomePassive())
                            break;

                        const std::string deviceID = entity_id.substr(MQTT_CLIENT_PREFIX_IO.length());
                        const std::string command(event->data, event->data_len);
                        if (deviceID.length() != NODE_ID_SIZE * 2)
                        {
                            ESP_LOGE(TAG, "Received command %s for device %s -> invalid device ID length!", command.c_str(), deviceID.c_str());
                            break;
                        }

                        // Parse command type — no RF calls here, just enqueue for the worker task.
                        MqttHelpers::MqttCmdType type{};
                        float value = 0.0f;
                        bool valid = true;

                        if (topic_str.ends_with(MQTT_CLIENT_COMMAND_TOPIC))
                        {
                            if      (command == "OPEN")     type = MqttHelpers::MqttCmdType::OPEN;
                            else if (command == "CLOSE")    type = MqttHelpers::MqttCmdType::CLOSE;
                            else if (command == "STOP")     type = MqttHelpers::MqttCmdType::STOP;
                            else if (command == "ON")       type = MqttHelpers::MqttCmdType::ON;
                            else if (command == "OFF")      type = MqttHelpers::MqttCmdType::OFF;
                            else if (command == "LOCK")     type = MqttHelpers::MqttCmdType::LOCK;
                            else if (command == "UNLOCK")   type = MqttHelpers::MqttCmdType::UNLOCK;
                            else if (command == "IDENTIFY") type = MqttHelpers::MqttCmdType::IDENTIFY;
                            else { ESP_LOGW(TAG, "Unrecognised command '%s' for %s", command.c_str(), deviceID.c_str()); valid = false; }
                        }
                        else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_POSITION_TOPIC))
                        {
                            value = strtof(command.c_str(), nullptr);
                            if (value >= 0.0f && value <= 100.0f) type = MqttHelpers::MqttCmdType::POSITION;
                            else { ESP_LOGE(TAG, "Invalid position '%s' for %s", command.c_str(), deviceID.c_str()); valid = false; }
                        }
                        else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_FAV_POS_TOPIC))
                        {
                            type = MqttHelpers::MqttCmdType::FAV_POS;
                        }
                        else if (topic_str.ends_with(MQTT_CLIENT_COMMAND_TILT_TOPIC))
                        {
                            value = strtof(command.c_str(), nullptr);
                            if (value >= 0.0f && value <= 100.0f) type = MqttHelpers::MqttCmdType::TILT;
                            else { ESP_LOGE(TAG, "Invalid tilt '%s' for %s", command.c_str(), deviceID.c_str()); valid = false; }
                        }
                        else
                        {
                            ESP_LOGE(TAG, "Received command %s for device %s -> invalid topic!", command.c_str(), deviceID.c_str());
                            valid = false;
                        }

                        if (valid)
                            mqttHelper->EnqueueCommand(deviceID, type, value);
                    }
                }
            }
            break;
        }
        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "MQTT_EVENT_ERROR");
            mqttHelper->OnMqttError();
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT)
            {
                ESP_LOGE(TAG, "Last error code reported from esp-tls: 0x%x", event->error_handle->esp_tls_last_esp_err);
                ESP_LOGE(TAG, "Last tls stack error number: 0x%x", event->error_handle->esp_tls_stack_err);
                ESP_LOGE(TAG, "Last captured errno : %d (%s)", event->error_handle->esp_transport_sock_errno,
                         strerror(event->error_handle->esp_transport_sock_errno));
            }
            else if (event->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED)
            {
                ESP_LOGE(TAG, "Connection refused error: 0x%x", event->error_handle->connect_return_code);
            }
            else
            {
                ESP_LOGE(TAG, "Unknown error type: 0x%x", event->error_handle->error_type);
            }
            break;
        default:
            ESP_LOGI(TAG, "Other event id:%d", event->event_id);
            break;
        }
    }

    bool MqttHelpers::isIoHomePassive()
    {
        return IoHomeConfig::isPassiveModeEnabled();
    }

    /// @brief Short name of a command type, for log lines
    static const char *CmdName(MqttHelpers::MqttCmdType type)
    {
        switch (type)
        {
            case MqttHelpers::MqttCmdType::OPEN:     return "OPEN";
            case MqttHelpers::MqttCmdType::CLOSE:    return "CLOSE";
            case MqttHelpers::MqttCmdType::STOP:     return "STOP";
            case MqttHelpers::MqttCmdType::ON:       return "ON";
            case MqttHelpers::MqttCmdType::OFF:      return "OFF";
            case MqttHelpers::MqttCmdType::LOCK:     return "LOCK";
            case MqttHelpers::MqttCmdType::UNLOCK:   return "UNLOCK";
            case MqttHelpers::MqttCmdType::IDENTIFY: return "IDENTIFY";
            case MqttHelpers::MqttCmdType::POSITION: return "POSITION";
            case MqttHelpers::MqttCmdType::FAV_POS:  return "FAV_POS";
            case MqttHelpers::MqttCmdType::TILT:     return "TILT";
        }
        return "?";
    }

    /// @brief true when @p a and @p b drive the same axis of the same device, so the newer one makes the older moot
    /// @note Tilt is its own axis: a venetian blind gets a position and a tilt command per scene, and one must
    ///       not cancel the other. IDENTIFY moves nothing for good and never supersedes anything.
    static bool SameTarget(const MqttCmd &a, const MqttCmd &b)
    {
        using T = MqttHelpers::MqttCmdType;
        if (a.type == T::IDENTIFY || b.type == T::IDENTIFY)
            return false;
        return strcmp(a.device_id, b.device_id) == 0 && (a.type == T::TILT) == (b.type == T::TILT);
    }

    enum class CmdResult { OK, FAILED, REJECTED };

    /// @brief Run one queued command over RF
    /// @return OK when the device authenticated it, REJECTED when it can never succeed (unknown/inactive
    ///         device), FAILED otherwise - worth sending again
    static CmdResult ExecuteCommand(MqttHelpers *self, IoRts::IoRtsManager *mgr, const MqttCmd &cmd)
    {
        using T = MqttHelpers::MqttCmdType;
        const std::string devId(cmd.device_id);
        bool quiet = false, inverted = false;
        {
            std::lock_guard<std::mutex> g(mgr->mIoDevicesMutex);
            auto it = mgr->mIoDevices.find(devId);
            if (it == mgr->mIoDevices.end() || it->second.is_deleted)
                return CmdResult::REJECTED;
            quiet    = it->second.quiet;
            inverted = it->second.info.is_openclose_inverted;
        }
        // Movement tracking only starts once the device accepted the command - otherwise the
        // interpolation would report a cover that never moved as "closing", then "closed".
        bool ok = false;
        switch (cmd.type)
        {
            case T::OPEN:
                ok = mgr->OpenDevice(devId, quiet);
                if (ok) mgr->StartMoveTracking(devId, inverted ? 100.0f : 0.0f);
                break;
            case T::CLOSE:
                ok = mgr->CloseDevice(devId, quiet);
                if (ok) mgr->StartMoveTracking(devId, inverted ? 0.0f : 100.0f);
                break;
            case T::STOP:
                ok = mgr->StopDevice(devId);
                if (ok && mgr->StopMoveTracking(devId))
                    self->SendIoDeviceStatus(devId); // publish retained position for 1W (no device feedback)
                break;
            case T::ON:
            case T::UNLOCK:
                ok = mgr->mIoHome->SetDevicePosition(devId, SWITCH_LIGHT_ON_POSITION);
                break;
            case T::OFF:
            case T::LOCK:
                ok = mgr->mIoHome->SetDevicePosition(devId, SWITCH_LIGHT_OFF_POSITION);
                break;
            case T::IDENTIFY:
                ok = mgr->mIoHome->IdentifyDevice(devId);
                break;
            case T::POSITION:
                ok = mgr->SetDevicePosition(devId, (uint8_t)cmd.value);
                if (ok) mgr->StartMoveTracking(devId, cmd.value);
                break;
            case T::FAV_POS:
                ok = mgr->mIoHome->SetDeviceToFavoritePosition(devId);
                break;
            case T::TILT:
                ok = mgr->mIoHome->SetDeviceTilt(devId, (uint8_t)cmd.value);
                break;
        }
        return ok ? CmdResult::OK : CmdResult::FAILED;
    }

    void MqttHelpers::EnqueueCommand(const std::string &deviceId, MqttCmdType type, float value)
    {
        MqttCmd cmd{};
        strncpy(cmd.device_id, deviceId.c_str(), sizeof(cmd.device_id) - 1);
        cmd.type  = type;
        cmd.value = value;
        if (xQueueSendToBack(mCommandQueue, &cmd, 0) == pdTRUE)
            return;
        // Rate-limited so a flood of commands doesn't also flood syslog. Only the MQTT task
        // enqueues, so these need no locking.
        static int64_t sLastDropLogUs = 0;
        static uint32_t sUnloggedDrops = 0;
        const int64_t now = esp_timer_get_time();
        if (sLastDropLogUs != 0 && now - sLastDropLogUs < MQTT_CMD_DROP_LOG_INTERVAL_US)
        {
            sUnloggedDrops++;
            return;
        }
        ESP_LOGE(TAG, "MQTT %s for %s DROPPED: command queue full (+%" PRIu32 " more dropped since last report)",
                 CmdName(type), deviceId.c_str(), sUnloggedDrops);
        sLastDropLogUs = now;
        sUnloggedDrops = 0;
    }

    void MqttHelpers::MqttCmdWorker(void *arg)
    {
        auto *self = static_cast<MqttHelpers *>(arg);
        auto *mgr  = self->mIoRtsManager;
        // Failed commands waiting to be sent again, ordered by due time. Owned by this task alone and
        // kept out of mCommandQueue so a retry never takes a slot from a fresh command, and fresh
        // commands always go first - a retry joins the back of the line.
        struct PendingRetry {
            MqttCmd    cmd;
            TickType_t due;
        };
        std::deque<PendingRetry> retries;
        MqttCmd cmd;
        bool holdingPolls = false;
        while (true)
        {
            TickType_t wait = portMAX_DELAY;
            if (!retries.empty())
            {
                const TickType_t left = retries.front().due - xTaskGetTickCount();
                wait = ((int32_t)left > 0) ? left : 0;
            }
            else if (holdingPolls)
                wait = pdMS_TO_TICKS(MQTT_CMD_BURST_GRACE_MS);

            if (xQueueReceive(self->mCommandQueue, &cmd, wait) == pdTRUE)
            {
                // A newer command for the same device and axis makes a pending retry moot - sending
                // it afterwards would undo what was just asked for.
                std::erase_if(retries, [&](const PendingRetry &r) {
                    if (!SameTarget(r.cmd, cmd))
                        return false;
                    ESP_LOGW(TAG, "MQTT %s for %s DROPPED: superseded by %s",
                             CmdName(r.cmd.type), r.cmd.device_id, CmdName(cmd.type));
                    return true;
                });
            }
            else if (!retries.empty() && (int32_t)(retries.front().due - xTaskGetTickCount()) <= 0)
            {
                cmd = retries.front().cmd;
                retries.pop_front();
            }
            else
            {
                if (holdingPolls && retries.empty())
                {
                    mgr->mIoHome->ReleaseStatusPolls(); // burst done — overdue polls run now
                    holdingPolls = false;
                }
                continue;
            }
            if (!holdingPolls)
            {
                mgr->mIoHome->HoldStatusPolls();
                holdingPolls = true;
            }

            // Only exceptions are logged; a normal command adds nothing to syslog.
            switch (ExecuteCommand(self, mgr, cmd))
            {
                case CmdResult::OK:
                    if (cmd.requeues > 0)
                        ESP_LOGI(TAG, "MQTT %s for %s succeeded on requeue %u",
                                 CmdName(cmd.type), cmd.device_id, cmd.requeues);
                    break;
                case CmdResult::REJECTED:
                    ESP_LOGW(TAG, "MQTT %s for %s REJECTED: unknown or inactive device",
                             CmdName(cmd.type), cmd.device_id);
                    break;
                case CmdResult::FAILED:
                    // IDENTIFY jogs the motor - not repeated behind the user's back.
                    if (cmd.type != MqttCmdType::IDENTIFY && cmd.requeues < MQTT_CMD_MAX_REQUEUES)
                    {
                        cmd.requeues++;
                        retries.push_back({cmd, xTaskGetTickCount() + pdMS_TO_TICKS(MQTT_CMD_REQUEUE_DELAY_MS)});
                        ESP_LOGW(TAG, "MQTT %s for %s failed (no authenticated reply), requeued %u/%u",
                                 CmdName(cmd.type), cmd.device_id, cmd.requeues, MQTT_CMD_MAX_REQUEUES);
                    }
                    else
                    {
                        ESP_LOGE(TAG, "MQTT %s for %s DROPPED: no authenticated reply after %u requeues",
                                 CmdName(cmd.type), cmd.device_id, cmd.requeues);
                    }
                    break;
            }
        }
    }

    MqttHelpers::MqttHelpers(IoRts::IoRtsManager *manager)
        : mIoRtsManager(manager), mStarted(false), mMqttClientHandle(nullptr), mReconnectTimer(nullptr)
    {
        mTopicPrefix = MqttConfig::GetTopicPrefix();
        mDiscoveryPrefix = MqttConfig::GetDiscoveryPrefix();
#ifdef CONFIG_CONNECTIVITY_CHOICE_WIFI
        esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &mqtt_network_event_handler, this);
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &mqtt_network_event_handler, this);
#endif
#ifdef CONFIG_CONNECTIVITY_CHOICE_ETH
        esp_event_handler_register(ETH_EVENT, ETHERNET_EVENT_DISCONNECTED, &mqtt_network_event_handler, this);
        esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, &mqtt_network_event_handler, this);
#endif
        mNetworkHandlersRegistered = true;
    }
    esp_err_t MqttHelpers::StartMqttClient()
    {
        std::lock_guard<std::recursive_mutex> lock(mLifecycleMutex);
        if (!MqttConfig::isEnabled() || mStarted)
            return ESP_ERR_NOT_ALLOWED;
        if (!NetworkHelpers::isConnected())
        {
            mMqttState = MqttState::CONNECTING;
            return ESP_ERR_INVALID_STATE;
        }
        esp_err_t err = ESP_OK;
        // Keep strings alive until esp_mqtt_client_init() consumes them
        std::string brokerAddress = MqttConfig::GetBrokerAddress();
        std::string clientId      = MqttConfig::GetClientId();
        std::string username      = MqttConfig::GetClientUsername();
        std::string password      = MqttConfig::GetClientPassword();
        std::string lastWillTopic = MqttConfig::GetTopicPrefix() + MQTT_CLIENT_BIRTH_WILL_TOPIC;
        std::string certificate;
        // Configure client
        esp_mqtt_client_config_t mqtt_cfg;
        memset(&mqtt_cfg, 0, sizeof(esp_mqtt_client_config_t));
        mqtt_cfg.broker.address.hostname = brokerAddress.c_str();
        mqtt_cfg.broker.address.port = MqttConfig::GetBrokerPort();
        bool tls_enabled = MqttConfig::isTLSEnabled();
        mqtt_cfg.broker.address.transport = tls_enabled ? MQTT_TRANSPORT_OVER_SSL : MQTT_TRANSPORT_OVER_TCP;
        if (tls_enabled)
        {
            certificate = MQTT_CERTIFICATE_BEGIN + MqttConfig::GetBrokerCertificate() + MQTT_CERTIFICATE_END;
            mqtt_cfg.broker.verification.certificate = certificate.c_str();
            mqtt_cfg.broker.verification.skip_cert_common_name_check = true;
        }
        mqtt_cfg.credentials.client_id = clientId.c_str();
        mqtt_cfg.credentials.username = username.c_str();
        mqtt_cfg.credentials.authentication.password = password.c_str();
        mqtt_cfg.session.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
        mqtt_cfg.session.last_will.topic = lastWillTopic.c_str();
        mqtt_cfg.session.last_will.msg = MQTT_CLIENT_WILL_MSG.c_str();
        mqtt_cfg.session.last_will.msg_len = MQTT_CLIENT_WILL_MSG.length();
        mqtt_cfg.session.last_will.qos = 1;
        mqtt_cfg.session.last_will.retain = true;
        mqtt_cfg.network.disable_auto_reconnect = true;
        mMqttClientHandle = esp_mqtt_client_init(&mqtt_cfg);
        if (mMqttClientHandle == NULL)
        {
            ESP_LOGE(TAG, "Failed to create MQTT client!");
            return ESP_FAIL;
        }
        // Create one-shot reconnect timer only on first start (reused across RestartMqttClient calls)
        if (mReconnectTimer == nullptr)
        {
            esp_timer_create_args_t timer_args = {};
            timer_args.callback = mqtt_reconnect_timer_cb;
            timer_args.arg = this;
            timer_args.name = "mqtt_reconnect";
            if (esp_timer_create(&timer_args, &mReconnectTimer) != ESP_OK)
            {
                ESP_LOGE(TAG, "Failed to create MQTT reconnect timer!");
                esp_mqtt_client_destroy(mMqttClientHandle);
                mMqttClientHandle = nullptr;
                return ESP_FAIL;
            }
        }
        // Register event handler
        err = esp_mqtt_client_register_event(mMqttClientHandle, MQTT_EVENT_ANY, mqtt_event_handler, this);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "Failed to register MQTT event handler! (%d)", err);
            esp_timer_delete(mReconnectTimer);
            mReconnectTimer = nullptr;
            esp_mqtt_client_destroy(mMqttClientHandle);
            mMqttClientHandle = nullptr;
            return ESP_FAIL;
        }
        // Start
        err = esp_mqtt_client_start(mMqttClientHandle);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "Failed to start MQTT client! (%d)", err);
            esp_mqtt_client_destroy(mMqttClientHandle);
            mMqttClientHandle = nullptr;
            return ESP_FAIL;
        }
        // Create command queue and worker task once — they outlive client restarts.
        if (mCommandQueue == nullptr)
        {
            mCommandQueue = xQueueCreate(MQTT_CMD_QUEUE_DEPTH, sizeof(MqttCmd));
            xTaskCreate(MqttCmdWorker, "mqtt_cmd", 4096, this, 5, &mCommandTask);
            ESP_LOGI(TAG, "MQTT command worker task started");
        }
        mStarted = true;
        mMqttState = MqttState::CONNECTING;
        return err;
    }

    esp_err_t MqttHelpers::RestartMqttClient()
    {
        std::lock_guard<std::recursive_mutex> lock(mLifecycleMutex);
        if (mStarted && mMqttClientHandle != nullptr)
        {
            // Tear down existing client; preserve the reconnect timer for reuse
            esp_timer_stop(mReconnectTimer);
            esp_mqtt_client_stop(mMqttClientHandle);
            esp_mqtt_client_destroy(mMqttClientHandle);
            mMqttClientHandle = nullptr;
            mStarted = false;
            mMqttConnected = false;
        }
        mMqttState = MqttState::DISABLED;
        if (!MqttConfig::isEnabled())
            return ESP_ERR_NOT_ALLOWED;
        // Re-read cached topic/discovery prefix so new values take effect immediately
        mTopicPrefix = MqttConfig::GetTopicPrefix();
        mDiscoveryPrefix = MqttConfig::GetDiscoveryPrefix();
        return StartMqttClient();
    }

    void MqttHelpers::SendDiscovery()
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr)
            return;
        // See https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery
        // Controller and IO devices are separate HA devices.
        // IO devices link back to the controller via "via_device".
        SendControllerDiscovery();
        if (!IoHomeConfig::isPassiveModeEnabled())
            SendIoDevicesDiscovery();
    }
    void MqttHelpers::SendControllerDiscovery()
    {
        bool error = false;
        std::string clientId = MqttConfig::GetClientId();
        std::string availability_topic = mTopicPrefix + MQTT_CLIENT_BIRTH_WILL_TOPIC;
        const esp_app_desc_t *desc = esp_app_get_description();

        cJSON *discovery = cJSON_CreateObject();
        if (discovery == NULL)
            return;

        // "dev" section — the controller
        cJSON *dev = cJSON_AddObjectToObject(discovery, "dev");
        if (dev == NULL)
            error = true;
        else
        {
            error = error || (cJSON_AddStringToObject(dev, "ids", clientId.c_str()) == NULL);  // identifiers
            error = error || (cJSON_AddStringToObject(dev, "name", clientId.c_str()) == NULL); // name
            error = error || (cJSON_AddStringToObject(dev, "mf", "nicolas5000 & rspaargaren") == NULL); // manufacturer
            error = error || (cJSON_AddStringToObject(dev, "sw", desc->version) == NULL);      // sw_version
        }

        // "o" (origin) section
        if (!error)
        {
            cJSON *o = cJSON_AddObjectToObject(discovery, "o");
            if (o == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(o, "name", clientId.c_str()) == NULL);                             // name
                error = error || (cJSON_AddStringToObject(o, "url", "https://github.com/nicolas5000/io-rts-esp32") == NULL); // support_url
                error = error || (cJSON_AddStringToObject(o, "sw", desc->version) == NULL);                                  // sw_version
            }
        }

        // "cmps" section — controller components only
        cJSON *cmps = NULL;
        if (!error)
        {
            cmps = cJSON_AddObjectToObject(discovery, "cmps");
            if (cmps == NULL)
                error = true;
        }
        if (!error)
        {
            // Add reboot button
            cJSON *cmp = cJSON_AddObjectToObject(cmps, "reboot");
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "button") == NULL);                              // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_REBOOT_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "Reboot") == NULL);                           // name
                std::string reboot_topic = mTopicPrefix + "/" + MQTT_CLIENT_REBOOT_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", reboot_topic.c_str()) == NULL); // command_topic
            }
        }
        if (!error)
        {
            // Add "IoLogging" switch https://www.home-assistant.io/integrations/switch.mqtt/
            cJSON *cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_IO_LOGGING_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "switch") == NULL);                                  // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_IO_LOGGING_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "Enable IO logging") == NULL);                    // name
                error = error || (cJSON_AddBoolToObject(cmp, "optimistic", true) == NULL);                               // optimistic
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL); // state_topic
                std::string value_template = "{{ value_json." + MQTT_CLIENT_IO_LOGGING_ID + " }}";
                error = error || (cJSON_AddStringToObject(cmp, "value_template", value_template.c_str()) == NULL); // value_template
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL); // command_topic
                std::string command_template = "{\"" + MQTT_CLIENT_IO_LOGGING_ID + "\": \"{{ value }}\"}";
                error = error || (cJSON_AddStringToObject(cmp, "command_template", command_template.c_str()) == NULL); // command_template
            }
        }
        if (!error)
        {
            // Add "IoPassive" switch https://www.home-assistant.io/integrations/switch.mqtt/
            cJSON *cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_IO_PASSIVE_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "switch") == NULL);                                  // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_IO_PASSIVE_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "Enable IO Passive mode") == NULL);               // name
                error = error || (cJSON_AddBoolToObject(cmp, "optimistic", true) == NULL);                               // optimistic
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL); // state_topic
                std::string value_template = "{{ value_json." + MQTT_CLIENT_IO_PASSIVE_ID + " }}";
                error = error || (cJSON_AddStringToObject(cmp, "value_template", value_template.c_str()) == NULL); // value_template
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL); // command_topic
                std::string command_template = "{\"" + MQTT_CLIENT_IO_PASSIVE_ID + "\": \"{{ value }}\"}";
                error = error || (cJSON_AddStringToObject(cmp, "command_template", command_template.c_str()) == NULL); // command_template
            }
        }
        if (!error)
        {
            // Add "IoTxPower" number https://www.home-assistant.io/integrations/number.mqtt/
            cJSON *cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_IO_TX_POWER_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "number") == NULL);                                   // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_IO_TX_POWER_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "IO Tx Power") == NULL);                           // name
                error = error || (cJSON_AddBoolToObject(cmp, "optimistic", true) == NULL);                                // optimistic
                error = error || (cJSON_AddNumberToObject(cmp, "min", 0) == NULL);                                        // min
                error = error || (cJSON_AddNumberToObject(cmp, "max", 20) == NULL);                                       // max
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL); // state_topic
                std::string value_template = "{{ value_json." + MQTT_CLIENT_IO_TX_POWER_ID + " }}";
                error = error || (cJSON_AddStringToObject(cmp, "value_template", value_template.c_str()) == NULL); // value_template
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_CONFIG_IO_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL); // command_topic
                std::string command_template = "{\"" + MQTT_CLIENT_IO_TX_POWER_ID + "\": {{ value }} }";
                error = error || (cJSON_AddStringToObject(cmp, "command_template", command_template.c_str()) == NULL); // command_template
            }
        }
        if (!error && !IoHomeConfig::isPassiveModeEnabled())
        {
            // Add 'Discover' button
            cJSON *cmp = cJSON_AddObjectToObject(cmps, "discover");
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "button") == NULL);                                // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_DISCOVER_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "Discover IO device") == NULL);                 // name
                std::string discover_topic = mTopicPrefix + "/" + MQTT_CLIENT_DISCOVER_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", discover_topic.c_str()) == NULL); // command_topic
            }
            // Add "AddIoDevice" text https://www.home-assistant.io/integrations/text.mqtt/
            cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_ADD_DEVICE_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "text") == NULL);                                    // platform
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_ADD_DEVICE_ID.c_str()) == NULL); // unique_id
                error = error || (cJSON_AddStringToObject(cmp, "name", "Add IO device") == NULL);                        // name
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_MANAGE_IO_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL); // command_topic
                std::string command_template = "{\"" + MQTT_CLIENT_ADD_DEVICE_ID + "\": \"{{ value }}\"}";
                error = error || (cJSON_AddStringToObject(cmp, "command_template", command_template.c_str()) == NULL); // command_template
            }
            // Add "DeactivateIoDevice" select (dropdown) — options are currently active devices
            cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_DEACT_DEVICE_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "select") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_DEACT_DEVICE_ID.c_str()) == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "name", "Deactivate IO device") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "icon", "mdi:eye-off-outline") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "entity_category", "config") == NULL);
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_DEACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL);
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_DEACT_SELECT_TOPIC + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL);
                // Build options list from active devices
                cJSON *options = cJSON_AddArrayToObject(cmp, "options");
                if (options == NULL)
                {
                    error = true;
                }
                else
                {
                    bool hasActive = false;
                    {
                        std::lock_guard<std::mutex> guard(mIoRtsManager->mIoDevicesMutex);
                        for (const auto &[id, dev] : mIoRtsManager->mIoDevices)
                        {
                            if (!dev.is_deleted)
                            {
                                std::string option = iohome::device_display_name(dev) + " (" + id + ")";
                                cJSON_AddItemToArray(options, cJSON_CreateString(option.c_str()));
                                hasActive = true;
                            }
                        }
                    }
                    if (!hasActive)
                        cJSON_AddItemToArray(options, cJSON_CreateString("— none —"));
                }
            }
            // Add "DeleteIoDevice" text (requires <ID>:CONFIRM — no HA confirmation on selects)
            cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_DEL_DEVICE_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "text") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_DEL_DEVICE_ID.c_str()) == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "name", "Delete IO device (ID:CONFIRM)") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "entity_category", "config") == NULL);
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_MANAGE_IO_ID + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL);
                std::string command_template = "{\"" + MQTT_CLIENT_DEL_DEVICE_ID + "\": \"{{ value }}\"}";
                error = error || (cJSON_AddStringToObject(cmp, "command_template", command_template.c_str()) == NULL);
            }
            // Add "ReactivateIoDevice" select (dropdown) — options are inactive devices
            cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_REACT_SELECT_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "select") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_REACT_SELECT_ID.c_str()) == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "name", "Re-activate IO device") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "icon", "mdi:eye-check") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "entity_category", "config") == NULL);
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_REACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL);
                std::string command_topic = mTopicPrefix + "/" + MQTT_CLIENT_REACT_SELECT_TOPIC + MQTT_CLIENT_COMMAND_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "command_topic", command_topic.c_str()) == NULL);
                // Build options list from inactive devices
                cJSON *options = cJSON_AddArrayToObject(cmp, "options");
                if (options == NULL)
                {
                    error = true;
                }
                else
                {
                    bool hasInactive = false;
                    {
                        std::lock_guard<std::mutex> guard(mIoRtsManager->mIoDevicesMutex);
                        for (const auto &[id, dev] : mIoRtsManager->mIoDevices)
                        {
                            if (dev.is_deleted)
                            {
                                std::string option = iohome::device_display_name(dev) + " (" + id + ")";
                                cJSON_AddItemToArray(options, cJSON_CreateString(option.c_str()));
                                hasInactive = true;
                            }
                        }
                    }
                    if (!hasInactive)
                        cJSON_AddItemToArray(options, cJSON_CreateString("— none —"));
                }
            }
            // Add "inactive_devices" sensor
            cmp = cJSON_AddObjectToObject(cmps, MQTT_CLIENT_INACTIVE_DEVICES_ID.c_str());
            if (cmp == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(cmp, "p", "sensor") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "unique_id", MQTT_CLIENT_INACTIVE_DEVICES_ID.c_str()) == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "name", "Inactive IO devices") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "icon", "mdi:eye-off") == NULL);
                error = error || (cJSON_AddStringToObject(cmp, "entity_category", "diagnostic") == NULL);
                std::string state_topic = mTopicPrefix + "/" + MQTT_CLIENT_INACTIVE_DEVICES_ID + MQTT_CLIENT_STATE_TOPIC;
                error = error || (cJSON_AddStringToObject(cmp, "state_topic", state_topic.c_str()) == NULL);
            }
        }

        // Shared availability
        error = error || (cJSON_AddStringToObject(discovery, "availability_topic", availability_topic.c_str()) == NULL);

        // Publish controller discovery
        if (!error)
        {
            std::string topic = mDiscoveryPrefix + MQTT_CLIENT_DISCOVERY_TOPIC;
            const char *data = cJSON_Print(discovery);
            if (data == NULL)
            {
                ESP_LOGE(TAG, "Failed to create controller discovery string");
            }
            else
            {
                esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), data, 0, 0, 1);
                cJSON_free((void *)data);
                ESP_LOGI(TAG, "Sent controller discovery successfully");
            }
        }
        cJSON_Delete(discovery);
    }
    void MqttHelpers::SendIoDevicesDiscovery()
    {
        std::string clientId = MqttConfig::GetClientId();
        std::string availability_topic = mTopicPrefix + MQTT_CLIENT_BIRTH_WILL_TOPIC;
        const esp_app_desc_t *desc = esp_app_get_description();

        // Compute the discovery base path (e.g. "homeassistant/device") from mDiscoveryPrefix
        // mDiscoveryPrefix is like "homeassistant/device/io-rts", we need "homeassistant/device"
        std::string discoveryBase = mDiscoveryPrefix;
        size_t lastSlash = discoveryBase.rfind('/');
        if (lastSlash != std::string::npos)
            discoveryBase = discoveryBase.substr(0, lastSlash);

        // Copy all device data under the mutex, then release before any blocking MQTT publish (M2).
        std::vector<std::pair<std::string, iohome::IoDevice>> deviceSnapshot;
        {
            std::lock_guard<std::mutex> guard(mIoRtsManager->mIoDevicesMutex);
            for (auto &entry : mIoRtsManager->mIoDevices)
                deviceSnapshot.push_back({entry.first, entry.second});
        }

        for (auto it = deviceSnapshot.begin(); it != deviceSnapshot.end(); ++it)
        {
            std::string device_id = MQTT_CLIENT_PREFIX_IO + it->first;

            // For deleted devices, send empty payload to remove the device discovery
            if (it->second.is_deleted)
            {
                std::string topic = discoveryBase + "/" + device_id + MQTT_CLIENT_DISCOVERY_TOPIC;
                esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), NULL, 0, 0, 1);
                continue;
            }

            bool error = false;
            cJSON *discovery = cJSON_CreateObject();
            if (discovery == NULL)
                continue;

            // "dev" section — this IO device, linked to controller via via_device
            cJSON *dev = cJSON_AddObjectToObject(discovery, "dev");
            if (dev == NULL)
                error = true;
            else
            {
                error = error || (cJSON_AddStringToObject(dev, "ids", device_id.c_str()) == NULL);                                         // identifiers
                error = error || (cJSON_AddStringToObject(dev, "name", iohome::device_display_name(it->second).c_str()) == NULL);           // name
                error = error || (cJSON_AddStringToObject(dev, "mf", IoDeviceManufacturer(it->second.info.manufacturer).c_str()) == NULL); // manufacturer
                error = error || (cJSON_AddStringToObject(dev, "mdl", IoDeviceType(it->second.info.device_type).c_str()) == NULL);         // model
                error = error || (cJSON_AddStringToObject(dev, "sn", it->first.c_str()) == NULL);                                          // serial_number (node address)
                error = error || (cJSON_AddStringToObject(dev, "via_device", clientId.c_str()) == NULL);                                   // via_device — links to controller
            }

            // "o" (origin) section
            if (!error)
            {
                cJSON *o = cJSON_AddObjectToObject(discovery, "o");
                if (o == NULL)
                    error = true;
                else
                {
                    error = error || (cJSON_AddStringToObject(o, "name", clientId.c_str()) == NULL);                             // name
                    error = error || (cJSON_AddStringToObject(o, "url", "https://github.com/nicolas5000/io-rts-esp32") == NULL); // support_url
                    error = error || (cJSON_AddStringToObject(o, "sw", desc->version) == NULL);                                  // sw_version
                }
            }

            // "cmps" section — device components
            cJSON *cmps = NULL;
            std::string device_state_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_STATE_TOPIC;
            std::string device_platform;
            if (!error)
            {
                cmps = cJSON_AddObjectToObject(discovery, "cmps");
                if (cmps == NULL)
                    error = true;
            }

            if (!error)
            {
                std::string device_id_fav = MQTT_CLIENT_PREFIX_IO + it->first + MQTT_CLIENT_SUFFIX_FAV_IO;
                std::string device_cmd_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_COMMAND_TOPIC;
                std::string device_position_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_POSITION_TOPIC;
                std::string device_cmd_position_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_COMMAND_POSITION_TOPIC;
                std::string device_tilt_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_TILT_TOPIC;
                std::string device_cmd_tilt_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_COMMAND_TILT_TOPIC;
                std::string device_cmd_fav_pos_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_COMMAND_FAV_POS_TOPIC;
                std::string device_manage_cmd_topic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + it->first + MQTT_CLIENT_SUFFIX_MANAGE + MQTT_CLIENT_COMMAND_TOPIC;
                std::string device_remotes_state_topic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + it->first + MQTT_CLIENT_SUFFIX_REMOTES + MQTT_CLIENT_STATE_TOPIC;

                cJSON *cmp = cJSON_AddObjectToObject(cmps, device_id.c_str());
                if (cmp == NULL)
                    error = true;
                else
                {
                    switch (it->second.info.device_type)
                    {
                    case DeviceType::VENETIAN_BLIND:
                    case DeviceType::ROLLER_SHUTTER:
                    case DeviceType::AWNING:
                    case DeviceType::WINDOW_OPENER:
                    case DeviceType::GARAGE_OPENER:
                    case DeviceType::GATE_OPENER:
                    case DeviceType::ROLLING_DOOR_OPENER:
                    case DeviceType::BLIND:
                    case DeviceType::DUAL_SHUTTER:
                    case DeviceType::HORIZONTAL_AWNING:
                    case DeviceType::EXTERNAL_VENETIAN_BLIND:
                    case DeviceType::LOUVRE_BLIND:
                    case DeviceType::CURTAIN_TRACK:
                    case DeviceType::SWINGING_SHUTTER:
                    {
                        // https://www.home-assistant.io/integrations/cover.mqtt/
                        device_platform = "cover";
                        if (it->second.info.is_openclose_inverted)
                        {
                            error = error || (cJSON_AddNumberToObject(cmp, "position_closed", 0) == NULL); // position_closed
                            error = error || (cJSON_AddNumberToObject(cmp, "position_open", 100) == NULL); // position_open
                        }
                        else
                        {
                            error = error || (cJSON_AddNumberToObject(cmp, "position_closed", 100) == NULL); // position_closed
                            error = error || (cJSON_AddNumberToObject(cmp, "position_open", 0) == NULL);     // position_open
                        }
                        error = error || (cJSON_AddStringToObject(cmp, "position_topic", device_position_topic.c_str()) == NULL);         // position_topic
                        error = error || (cJSON_AddStringToObject(cmp, "set_position_topic", device_cmd_position_topic.c_str()) == NULL); // set_position_topic
                        // add tilt topics if device supports tilt
                        if (iohome::deviceTypeSupportsTilt(it->second.info.device_type))
                        {
                            error = error || (cJSON_AddStringToObject(cmp, "tilt_status_topic", device_tilt_topic.c_str()) == NULL);      // tilt_status_topic
                            error = error || (cJSON_AddStringToObject(cmp, "tilt_command_topic", device_cmd_tilt_topic.c_str()) == NULL); // tilt_command_topic
                            error = error || (cJSON_AddNumberToObject(cmp, "tilt_closed_value", 0) == NULL);                              // tilt_closed_value
                            error = error || (cJSON_AddNumberToObject(cmp, "tilt_opened_value", 100) == NULL);                            // tilt_opened_value
                            error = error || (cJSON_AddNumberToObject(cmp, "tilt_min", 0) == NULL);                                       // tilt_min
                            error = error || (cJSON_AddNumberToObject(cmp, "tilt_max", 100) == NULL);                                     // tilt_max
                        }
                        // add device_class https://www.home-assistant.io/integrations/cover/#device_class
                        std::string type = "shutter";
                        switch (it->second.info.device_type)
                        {
                        case DeviceType::VENETIAN_BLIND:
                        case DeviceType::BLIND:
                        case DeviceType::EXTERNAL_VENETIAN_BLIND:
                        case DeviceType::LOUVRE_BLIND:
                            type = "blind";
                            break;
                        case DeviceType::ROLLER_SHUTTER:
                        case DeviceType::DUAL_SHUTTER:
                        case DeviceType::SWINGING_SHUTTER:
                            type = "shutter";
                            break;
                        case DeviceType::AWNING:
                        case DeviceType::HORIZONTAL_AWNING:
                            type = "awning";
                            break;
                        case DeviceType::WINDOW_OPENER:
                            type = "window";
                            break;
                        case DeviceType::GARAGE_OPENER:
                            type = "garage";
                            break;
                        case DeviceType::GATE_OPENER:
                            type = "gate";
                            break;
                        case DeviceType::ROLLING_DOOR_OPENER:
                            type = "door";
                            break;
                        case DeviceType::CURTAIN_TRACK:
                            type = "curtain";
                            break;
                        default:
                            type = "None";
                            break;
                        }
                        error = error || (cJSON_AddStringToObject(cmp, "device_class", type.c_str()) == NULL); // device_class
                        // add "favorite position" button as a separate component
                        if (!error)
                        {
                            cJSON *fav = cJSON_AddObjectToObject(cmps, device_id_fav.c_str());
                            if (fav == NULL)
                                error = true;
                            else
                            {
                                error = error || (cJSON_AddStringToObject(fav, "p", "button") == NULL);                      // platform
                                error = error || (cJSON_AddStringToObject(fav, "unique_id", device_id_fav.c_str()) == NULL); // unique_id
                                std::string favName = iohome::device_display_name(it->second) + " Favorite position";
                                error = error || (cJSON_AddStringToObject(fav, "name", favName.c_str()) == NULL);                           // name
                                error = error || (cJSON_AddStringToObject(fav, "command_topic", device_cmd_fav_pos_topic.c_str()) == NULL); // command_topic
                            }
                        }
                        break;
                    }
                    case DeviceType::LIGHT:
                        // https://www.home-assistant.io/integrations/light.mqtt/
                        device_platform = "light";
                        error = error || (cJSON_AddStringToObject(cmp, "optimistic", "true") == NULL); // optimistic
                        // TODO: manage brightness, waiting for feedback
                        break;
                    case DeviceType::ON_OFF_SWITCH:
                        // https://www.home-assistant.io/integrations/switch.mqtt/
                        device_platform = "switch";
                        error = error || (cJSON_AddStringToObject(cmp, "optimistic", "true") == NULL); // optimistic
                        break;
                    case DeviceType::LOCK:
                        // https://www.home-assistant.io/integrations/lock.mqtt/
                        device_platform = "lock";
                        break;
                    // other device types we don't support yet so don't send MQTT discovery for now
                    case DeviceType::UNKNOWN:
                    case DeviceType::UNKNOWN_0B:
                    case DeviceType::BEACON:
                    case DeviceType::HEATING_TEMPERATURE_INTERFACE:
                    case DeviceType::VENTILATION_POINT:
                    case DeviceType::EXTERIOR_HEATING:
                    case DeviceType::HEAT_PUMP:
                    case DeviceType::INTRUSION_ALARM:
                    default:
                        ESP_LOGE(TAG, "Failed to add device to MQTT discovery: type not managed! (%d)", static_cast<int>(it->second.info.device_type));
                        cJSON_Delete(discovery);
                        continue; // skip this device entirely
                    }
                    // Common fields for all supported device types
                    error = error || (cJSON_AddStringToObject(cmp, "p", device_platform.c_str()) == NULL);              // platform
                    error = error || (cJSON_AddStringToObject(cmp, "unique_id", device_id.c_str()) == NULL);            // unique_id
                    error = error || (cJSON_AddStringToObject(cmp, "name", iohome::device_display_name(it->second).c_str()) == NULL); // name
                    error = error || (cJSON_AddStringToObject(cmp, "command_topic", device_cmd_topic.c_str()) == NULL); // command_topic
                    error = error || (cJSON_AddStringToObject(cmp, "state_topic", device_state_topic.c_str()) == NULL); // state_topic
                }

                // add "identify" button as a separate component for all device types
                if (!error)
                {
                    std::string device_id_ident = MQTT_CLIENT_PREFIX_IO + it->first + MQTT_CLIENT_SUFFIX_IDENTIFY;
                    std::string device_cmd_topic = GetTopicPrefix() + "/" + device_id + MQTT_CLIENT_COMMAND_TOPIC;
                    cJSON *ident = cJSON_AddObjectToObject(cmps, device_id_ident.c_str());
                    if (ident == NULL)
                        error = true;
                    else
                    {
                        error = error || (cJSON_AddStringToObject(ident, "p", "button") == NULL);                        // platform
                        error = error || (cJSON_AddStringToObject(ident, "unique_id", device_id_ident.c_str()) == NULL); // unique_id
                        std::string identName = iohome::device_display_name(it->second) + " Identify";
                        error = error || (cJSON_AddStringToObject(ident, "name", identName.c_str()) == NULL);                 // name
                        error = error || (cJSON_AddStringToObject(ident, "command_topic", device_cmd_topic.c_str()) == NULL); // command_topic — uses /set
                        error = error || (cJSON_AddStringToObject(ident, "payload_press", "IDENTIFY") == NULL);               // payload_press
                        error = error || (cJSON_AddStringToObject(ident, "device_class", "identify") == NULL);                // device_class
                        error = error || (cJSON_AddStringToObject(ident, "entity_category", "diagnostic") == NULL);           // entity_category
                    }
                }
                // Per-device management entities (configuration category)
                if (!error)
                {
                    std::string deviceNodeID = it->first;
                    std::string devName = iohome::device_display_name(it->second);
                    // transit time number — cover devices only
                    if (device_platform == "cover")
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + MQTT_CLIENT_SUFFIX_TRANSIT;
                        std::string transitStateTopic = GetTopicPrefix() + "/" + uid + MQTT_CLIENT_STATE_TOPIC;
                        cJSON *cmpTransit = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpTransit == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpTransit, "p", "number") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "name", (devName + " Transition time").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "icon", "mdi:timer-outline") == NULL);
                        error = error || (cJSON_AddNumberToObject(cmpTransit, "min", 1) == NULL);
                        error = error || (cJSON_AddNumberToObject(cmpTransit, "max", 300) == NULL);
                        error = error || (cJSON_AddNumberToObject(cmpTransit, "step", 1) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "unit_of_measurement", "s") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "state_topic", transitStateTopic.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpTransit, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        std::string tmpl = "{\"action\":\"set_transit_time\",\"value\":{{ value | int }}}";
                        error = error || (cJSON_AddStringToObject(cmpTransit, "command_template", tmpl.c_str()) == NULL);
                    }
                    // rename text
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + "_rename";
                        cJSON *cmpRename = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpRename == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpRename, "p", "text") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRename, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRename, "name", (devName + " Rename").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRename, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRename, "icon", "mdi:rename") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRename, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        std::string tmpl = "{\"action\":\"rename\",\"value\":\"{{ value }}\"}";
                        error = error || (cJSON_AddStringToObject(cmpRename, "command_template", tmpl.c_str()) == NULL);
                    }
                    // deactivate button
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + "_deactivate";
                        cJSON *cmpDeact = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpDeact == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpDeact, "p", "button") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "name", (devName + " Deactivate").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "icon", "mdi:eye-off-outline") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpDeact, "payload_press", "{\"action\":\"deactivate\"}") == NULL);
                    }
                    // invert button
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + "_invert";
                        cJSON *cmpInvert = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpInvert == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpInvert, "p", "button") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "name", (devName + " Invert open/close").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "icon", "mdi:swap-vertical") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpInvert, "payload_press", "{\"action\":\"invert\"}") == NULL);
                    }
                    // link_remote text
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + "_link_remote";
                        cJSON *cmpLink = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpLink == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpLink, "p", "text") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpLink, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpLink, "name", (devName + " Link remote").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpLink, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpLink, "icon", "mdi:remote-tv") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpLink, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        std::string tmpl = "{\"action\":\"link_remote\",\"value\":\"{{ value }}\"}";
                        error = error || (cJSON_AddStringToObject(cmpLink, "command_template", tmpl.c_str()) == NULL);
                    }
                    // linked_remotes diagnostic sensor
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + MQTT_CLIENT_SUFFIX_REMOTES;
                        cJSON *cmpRemotes = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpRemotes == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "p", "sensor") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "name", (devName + " Linked remotes").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "entity_category", "diagnostic") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "icon", "mdi:remote") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemotes, "state_topic", device_remotes_state_topic.c_str()) == NULL);
                    }
                    // remove_remote text
                    {
                        std::string uid = MQTT_CLIENT_PREFIX_IO + deviceNodeID + "_remove_remote";
                        cJSON *cmpRemRem = cJSON_AddObjectToObject(cmps, uid.c_str());
                        if (cmpRemRem == NULL) { error = true; goto manage_done; }
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "p", "text") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "unique_id", uid.c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "name", (devName + " Remove remote").c_str()) == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "entity_category", "config") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "icon", "mdi:remote-off") == NULL);
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "command_topic", device_manage_cmd_topic.c_str()) == NULL);
                        std::string tmpl = "{\"action\":\"remove_remote\",\"value\":\"{{ value }}\"}";
                        error = error || (cJSON_AddStringToObject(cmpRemRem, "command_template", tmpl.c_str()) == NULL);
                    }
                    manage_done:;
                }
            }

            // Shared availability — uses controller's status topic
            error = error || (cJSON_AddStringToObject(discovery, "availability_topic", availability_topic.c_str()) == NULL);

            // Publish this IO device's discovery
            if (!error)
            {
                std::string topic = discoveryBase + "/" + device_id + MQTT_CLIENT_DISCOVERY_TOPIC;
                const char *data = cJSON_Print(discovery);
                if (data == NULL)
                {
                    ESP_LOGE(TAG, "Failed to create IO device discovery string for %s", it->first.c_str());
                }
                else
                {
                    esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), data, 0, 0, 1);
                    cJSON_free((void *)data);
                    ESP_LOGD(TAG, "Sent IO device discovery for %s", it->first.c_str());
                }
                // Clear stale retained state for cover devices with unknown position so HA shows "unknown" rather than a stale "open".
                if (device_platform == "cover" && it->second.position == UNKNOWN_POSITION)
                    esp_mqtt_client_publish(mMqttClientHandle, device_state_topic.c_str(), NULL, 0, 0, 1);
            }
            cJSON_Delete(discovery);
        }
        ESP_LOGI(TAG, "Sent all IO device discoveries");
    }
    void MqttHelpers::SendIoDeviceStatus(const std::string &deviceId)
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr || IoHomeConfig::isPassiveModeEnabled())
            return; // don't send status if in passive mode

        // Copy device data under the mutex, then release before any blocking MQTT publish (M2).
        if (mIoRtsManager == nullptr)
            return;
        iohome::IoDevice deviceCopy;
        {
            std::lock_guard<std::mutex> guard(mIoRtsManager->mIoDevicesMutex);
            auto device = mIoRtsManager->mIoDevices.find(deviceId);
            if (device == mIoRtsManager->mIoDevices.end())
                return;
            deviceCopy = device->second; // copy by value — mutex released after this block
        }

        // All MQTT publishes happen here with no mutex held.
        std::string stateTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_STATE_TOPIC;
        std::string positionTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_POSITION_TOPIC;
        std::string data;
        if (deviceCopy.is_deleted)
        {
            // device is marked as deleted, send empty messages to remove all retained messages for this device
            esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), NULL, 0, 0, 1);
            esp_mqtt_client_publish(mMqttClientHandle, positionTopic.c_str(), NULL, 0, 0, 1);
            if (iohome::deviceTypeSupportsTilt(deviceCopy.info.device_type))
            {
                std::string tiltTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_TILT_TOPIC;
                esp_mqtt_client_publish(mMqttClientHandle, tiltTopic.c_str(), NULL, 0, 0, 1);
            }
            {
                std::string transitTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_SUFFIX_TRANSIT + MQTT_CLIENT_STATE_TOPIC;
                esp_mqtt_client_publish(mMqttClientHandle, transitTopic.c_str(), NULL, 0, 0, 1);
            }
            return;
        }
        switch (deviceCopy.info.device_type)
        {
        case DeviceType::VENETIAN_BLIND:
        case DeviceType::ROLLER_SHUTTER:
        case DeviceType::AWNING:
        case DeviceType::WINDOW_OPENER:
        case DeviceType::GARAGE_OPENER:
        case DeviceType::GATE_OPENER:
        case DeviceType::ROLLING_DOOR_OPENER:
        case DeviceType::BLIND:
        case DeviceType::DUAL_SHUTTER:
        case DeviceType::HORIZONTAL_AWNING:
        case DeviceType::EXTERNAL_VENETIAN_BLIND:
        case DeviceType::LOUVRE_BLIND:
        case DeviceType::CURTAIN_TRACK:
        case DeviceType::SWINGING_SHUTTER:
            // send position
            if (deviceCopy.position != UNKNOWN_POSITION)
            {
                data = std::to_string((int)deviceCopy.position);
                esp_mqtt_client_publish(mMqttClientHandle, positionTopic.c_str(), data.c_str(), 0, 0, 1);
                // send state
                if (deviceCopy.is_stopped)
                {
                    if (deviceCopy.info.is_openclose_inverted)
                    {
                        if (deviceCopy.position < (float)0.1)
                            data = "closed";
                        else
                            data = "open";
                    }
                    else
                    {
                        if (deviceCopy.position > (float)99.9)
                            data = "closed";
                        else
                            data = "open";
                    }
                }
                else
                {
                    // Guard against UNKNOWN_POSITION target before direction comparison (M6).
                    if (deviceCopy.target != UNKNOWN_POSITION)
                    {
                        if (deviceCopy.position > deviceCopy.target)
                            data = deviceCopy.info.is_openclose_inverted ? "closing" : "opening";
                        else
                            data = deviceCopy.info.is_openclose_inverted ? "opening" : "closing";
                    }
                    else
                    {
                        // Target unknown — use safe default direction
                        data = deviceCopy.info.is_openclose_inverted ? "opening" : "closing";
                    }
                }
                esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), data.c_str(), 0, 0, 1);
                // send tilt if device supports it
                if (iohome::deviceTypeSupportsTilt(deviceCopy.info.device_type) && deviceCopy.tilt != UNKNOWN_POSITION)
                {
                    std::string tiltTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_TILT_TOPIC;
                    data = std::to_string((int)deviceCopy.tilt);
                    esp_mqtt_client_publish(mMqttClientHandle, tiltTopic.c_str(), data.c_str(), 0, 0, 1);
                }
            }
            else
            {
                // Skip state topic — publishing "open" by default causes stale retained state in HA for 1W devices that never report position.
                esp_mqtt_client_publish(mMqttClientHandle, positionTopic.c_str(), "None", 0, 0, 1);
            }
            // publish transit time (0 = uncalibrated, published as empty to avoid HA showing 0)
            {
                std::string transitTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_SUFFIX_TRANSIT + MQTT_CLIENT_STATE_TOPIC;
                if (deviceCopy.transit_time_ms > 0)
                {
                    data = std::to_string(deviceCopy.transit_time_ms / 1000);
                    esp_mqtt_client_publish(mMqttClientHandle, transitTopic.c_str(), data.c_str(), 0, 0, 1);
                }
            }
            break;
        case DeviceType::LIGHT:
            if (!deviceCopy.is_stopped)
                return; // don't send current position as it is not correct
            if (deviceCopy.position == 0)
                data = "ON";
            else if (deviceCopy.position == UNKNOWN_POSITION)
                data = "None";
            else
                data = "OFF";
            esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), data.c_str(), 0, 0, 1);
            // TODO: manage brightness, waiting for feedback
            break;
        case DeviceType::ON_OFF_SWITCH:
            if (!deviceCopy.is_stopped)
                return; // don't send current position as it is not correct
            if (deviceCopy.position == 0)
                data = "ON";
            else if (deviceCopy.position == UNKNOWN_POSITION)
                data = "None";
            else
                data = "OFF";
            esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), data.c_str(), 0, 0, 1);
            break;
        case DeviceType::LOCK:
            if (deviceCopy.position != UNKNOWN_POSITION)
            {
                // find state
                if (deviceCopy.is_stopped)
                {
                    if (deviceCopy.position > (float)99.9)
                        data = "LOCKED";
                    else
                        data = "UNLOCKED";
                }
                else // not sure this can happen, waiting for feedback
                {
                    // Guard against UNKNOWN_POSITION target before direction comparison (M6).
                    if (deviceCopy.target != UNKNOWN_POSITION)
                    {
                        if (deviceCopy.position > deviceCopy.target)
                            data = "UNLOCKING";
                        else
                            data = "LOCKING";
                    }
                    else
                    {
                        data = "LOCKING"; // safe default when target unknown
                    }
                }
            }
            else
            {
                data = "None";
            }
            esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), data.c_str(), 0, 0, 1);
            break;
        // other device types we don't support yet so don't send MQTT discovery for now
        case DeviceType::UNKNOWN:
        case DeviceType::UNKNOWN_0B:
        case DeviceType::BEACON:
        case DeviceType::HEATING_TEMPERATURE_INTERFACE:
        case DeviceType::VENTILATION_POINT:
        case DeviceType::EXTERIOR_HEATING:
        case DeviceType::HEAT_PUMP:
        case DeviceType::INTRUSION_ALARM:
        default:
            break;
        }
    }
    void MqttHelpers::PublishInactiveDevicesList()
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr || mIoRtsManager == nullptr)
            return;
        // Build semicolon-separated list of inactive devices and publish to state topic
        std::string list;
        {
            std::lock_guard<std::mutex> guard(mIoRtsManager->mIoDevicesMutex);
            for (const auto &[id, dev] : mIoRtsManager->mIoDevices)
            {
                if (dev.is_deleted)
                {
                    if (!list.empty()) list += "; ";
                    list += iohome::device_display_name(dev) + " (" + id + ")";
                }
            }
        }
        if (list.empty()) list = "none";
        std::string topic = mTopicPrefix + "/" + MQTT_CLIENT_INACTIVE_DEVICES_ID + MQTT_CLIENT_STATE_TOPIC;
        esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), list.c_str(), 0, 0, 1);
        // Reset both select states to placeholder
        std::string react_state = mTopicPrefix + "/" + MQTT_CLIENT_REACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
        esp_mqtt_client_publish(mMqttClientHandle, react_state.c_str(), "— none —", 0, 0, 0);
        std::string deact_state = mTopicPrefix + "/" + MQTT_CLIENT_DEACT_SELECT_TOPIC + MQTT_CLIENT_STATE_TOPIC;
        esp_mqtt_client_publish(mMqttClientHandle, deact_state.c_str(), "— none —", 0, 0, 0);
        // Re-publish controller discovery to update both dropdown option lists in HA
        SendControllerDiscovery();
    }
    void MqttHelpers::PublishDeviceRemotesList(const std::string &deviceID)
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr)
            return;
        Helpers::StoredIoDevice stored;
        if (Helpers::DeviceStorage::LoadIoDevice(deviceID, stored) == ESP_OK)
            PublishDeviceRemotesList(deviceID, stored);
    }

    void MqttHelpers::PublishDeviceRemotesList(const std::string &deviceID, const Helpers::StoredIoDevice &stored)
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr)
            return;
        std::string list;
        for (const std::string &remote : stored.linked_remotes)
        {
            if (!list.empty()) list += "; ";
            list += remote;
        }
        if (list.empty()) list = "none";
        std::string topic = mTopicPrefix + "/" + MQTT_CLIENT_PREFIX_IO + deviceID + MQTT_CLIENT_SUFFIX_REMOTES + MQTT_CLIENT_STATE_TOPIC;
        esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), list.c_str(), 0, 0, 1);
    }
    void MqttHelpers::PublishEstimatedPosition(const std::string &deviceId, int position, const char *state)
    {
        if (!mMqttConnected || mMqttClientHandle == nullptr) return;
        std::string positionTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_POSITION_TOPIC;
        std::string data = std::to_string(position);
        esp_mqtt_client_publish(mMqttClientHandle, positionTopic.c_str(), data.c_str(), 0, 0, 0); // retain=0
        if (state != nullptr)
        {
            std::string stateTopic = GetTopicPrefix() + "/" + MQTT_CLIENT_PREFIX_IO + deviceId + MQTT_CLIENT_STATE_TOPIC;
            esp_mqtt_client_publish(mMqttClientHandle, stateTopic.c_str(), state, 0, 0, 0); // retain=0
        }
    }

    void MqttHelpers::SendLog(const std::string &log)
    {
        // Drop logs that arrive before the MQTT client is actually started: esp_mqtt_client_publish
        // dereferences an internal mutex that is only created by esp_mqtt_client_init (called from
        // StartMqttClient). The IoHomeControl log task can fire before StartMqttClient has run and
        // would otherwise crash the system on a null pointer.
        if (!mMqttConnected || mMqttClientHandle == nullptr)
            return;
        std::string topic = mTopicPrefix + MQTT_CLIENT_LOG_TOPIC;
        esp_mqtt_client_publish(mMqttClientHandle, topic.c_str(), log.c_str(), 0, 0, 0);
    }
    void MqttHelpers::OnNetworkConnected()
    {
        std::lock_guard<std::recursive_mutex> lock(mLifecycleMutex);
        if (!NetworkHelpers::isConnected())
            return;
        if (!mStarted || mMqttClientHandle == nullptr)
        {
            esp_err_t err = StartMqttClient();
            if (err != ESP_OK && err != ESP_ERR_NOT_ALLOWED)
                ESP_LOGE(TAG, "Failed to start MQTT client after network connected (%d)", err);
            return;
        }
        esp_timer_stop(mReconnectTimer); // cancel any pending broker-drop retry
        ESP_LOGI(TAG, "Network up — triggering MQTT reconnect");
        esp_mqtt_client_reconnect(mMqttClientHandle);
    }
    void MqttHelpers::OnNetworkDisconnected()
    {
        mMqttConnected = false;
        if (mMqttState != MqttState::ERROR)
            mMqttState = MqttState::DISCONNECTED;
        if (!mStarted || mReconnectTimer == nullptr)
            return;
        ESP_LOGI(TAG, "Network down — cancelling MQTT reconnect timer");
        esp_timer_stop(mReconnectTimer);
    }
    const char *MqttHelpers::GetMqttStatusString() const
    {
        switch (mMqttState) {
            case MqttState::CONNECTING:    return "connecting";
            case MqttState::CONNECTED:     return "connected";
            case MqttState::DISCONNECTED:  return "disconnected";
            case MqttState::ERROR:         return "error";
            default:                       return "disabled";
        }
    }

    void MqttHelpers::OnMqttConnected()
    {
        mMqttConnected = true;
        mMqttState = MqttState::CONNECTED;
    }

    void MqttHelpers::OnMqttDisconnected()
    {
        mMqttConnected = false;
        if (mMqttState != MqttState::ERROR)
            mMqttState = MqttState::DISCONNECTED;
        if (!mStarted || mMqttClientHandle == nullptr || mReconnectTimer == nullptr)
            return;
        if (NetworkHelpers::isConnected())
        {
            // WiFi is up — broker dropped independently; retry in 5 seconds
            esp_timer_stop(mReconnectTimer);
            esp_timer_start_once(mReconnectTimer, 5ULL * 1000 * 1000);
            ESP_LOGI(TAG, "Broker unreachable — will retry in 5s");
        }
        // If WiFi is down, OnNetworkConnected() will trigger reconnect when IP is obtained
    }
}