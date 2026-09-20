#pragma once

#include <string>
#include "esp_err.h"

namespace Config
{
    class IntegrationConfig
    {
    public:
        /// @brief Get the active integration mode from NVS
        /// @return "mqtt" | "esphome" | "none". Default: "mqtt"
        static std::string GetMode();

        /// @brief Store the integration mode to NVS
        /// @param mode integration mode string ("mqtt", "esphome", or "none")
        /// @return ESP_OK on success
        static esp_err_t SetMode(const std::string &mode);
    };
}
