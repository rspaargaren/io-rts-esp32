#pragma once

#include <string>

#include "esp_err.h"

namespace Config
{
    constexpr size_t PASSWORD_MAXSIZE = 32;
    
    class MiscConfig
    {
    public:
        /// @brief Delete access password in storage (reset to password defined at build in SDK configuration)
        static void ResetAccessPassword();

        /// @brief Check if there is an access password currently defined
        /// @return true if password is defined (not empty)
        static bool isAccessPasswordDefined();

        /// @brief Compare given password to access password in storage
        /// @param password access password to compare
        /// @return true if password is valid
        static bool CheckAccessPassword(const std::string &password);

        /// @brief Set access password to configuration storage
        /// @param password access password to store
        /// @return ESP_OK if configuration put to storage without error
        static esp_err_t SetAccessPassword(const std::string &password);

        /// @brief Get effective access password — NVS value if set, otherwise compile-time default
        /// @return current password
        static const std::string GetEffectiveAccessPassword();

    private:
        static const std::string GetAccessPassword();
    };

}