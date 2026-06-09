#pragma once

#include <string>
#include <map>
#include <list>

#include "esp_err.h"
#include "iohome_device.hpp"

namespace Helpers
{
    /// @brief Stored IO device data (static information + linked remotes)
    struct StoredIoDevice
    {
        iohome::IoDevice device;               // Device information
        std::list<std::string> linked_remotes; // Remote IDs linked to this device
        uint32_t transit_time_ms = 0;          // Time to travel full range (0 = uncalibrated)
    };

    class DeviceStorage
    {
    public:
        /// @brief Initialize LittleFS partition for device storage. Must be called before any read/write operation.
        /// @return ESP_OK if no error
        static esp_err_t Init();

        /// @brief Load a single IO device from flash storage
        /// @param deviceID Device ID (6 characters as hex representation of the 3 bytes, eg "112233")
        /// @param storedDevice Will be filled with device data
        /// @return ESP_OK if no error, ESP_ERR_NOT_FOUND if device doesn't exist
        static esp_err_t LoadIoDevice(const std::string &deviceID, StoredIoDevice &storedDevice);

        /// @brief Load all IO devices from flash storage
        /// @param devices Map that will be filled with all stored IO devices (deviceID -> StoredIoDevice)
        /// @return ESP_OK if no error
        static esp_err_t LoadAllIoDevices(std::map<std::string, StoredIoDevice> &devices);

        /// @brief Save an IO device to flash storage (creates or overwrites)
        /// @param deviceID Device ID (6 characters as hex representation of the 3 bytes, eg "112233")
        /// @param device Device data to store
        /// @return ESP_OK if no error
        static esp_err_t SaveIoDevice(const std::string &deviceID, const StoredIoDevice &device);

        /// @brief Remove an IO device file from flash storage
        /// @param deviceID Device ID (6 characters as hex representation of the 3 bytes, eg "112233")
        /// @return ESP_OK if no error, ESP_ERR_NOT_FOUND if device doesn't exist
        static esp_err_t RemoveIoDevice(const std::string &deviceID);

        /// @brief Add a remote link to an existing stored IO device
        /// @param remoteID Remote ID (6 characters hex)
        /// @param deviceID Device ID (6 characters hex)
        /// @return ESP_OK if no error
        static esp_err_t AddRemoteToIoDevice(const std::string &remoteID, const std::string &deviceID);

        /// @brief Remove a remote link from all stored IO devices
        /// @param remoteID Remote ID (6 characters hex)
        /// @return ESP_OK if no error
        static esp_err_t RemoveRemoteFromIoDevices(const std::string &remoteID);

    private:
        /// @brief Build the file path for an IO device
        /// @param deviceID Device ID
        /// @return Full path to the device file (eg "/devices/112233.json")
        static std::string GetIoDeviceFilePath(const std::string &deviceID);

        /// @brief Serialize a StoredIoDevice to JSON and write to file
        /// @param filePath Path to file
        /// @param deviceID Device ID
        /// @param storedDevice Device data to serialize
        /// @return ESP_OK if no error
        static esp_err_t WriteIoDeviceFile(const std::string &filePath, const std::string &deviceID, const StoredIoDevice &storedDevice);

        /// @brief Read and deserialize an IO device from a JSON file
        /// @param filePath Path to file
        /// @param deviceID Will be set to the device ID from the file
        /// @param storedDevice Will be filled with deserialized device data
        /// @return ESP_OK if no error
        static esp_err_t ReadIoDeviceFile(const std::string &filePath, std::string &deviceID, StoredIoDevice &storedDevice);
    };
}
