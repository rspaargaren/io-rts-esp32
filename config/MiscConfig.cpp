#include "MiscConfig.hpp"
#include "NvsHelpers.hpp"

#include "sdkconfig.h"
#include <string.h>

static const std::string MISC_CONFIG_NAMESPACE = "misc";        // namespace to group network configuration in NVS
static const std::string MISC_CONFIG_ACCESS_PWD = "access_pwd"; // Key to store Access password (string)

using namespace Helpers;

namespace Config
{
    /// @brief Compare buffers in constant time to avoid timing attack
    /// @param a First buffer to compare
    /// @param b Second buffer to compare
    /// @param len Buffer length for both buffers
    /// @return true if buffers are same
    static bool constant_time_compare(const char *a, const char *b, size_t len)
    {
        uint8_t result = 0;

        for (size_t i = 0; i < len; i++)
        {
            result |= a[i] ^ b[i];
        }

        return (result == 0);
    }

    void MiscConfig::ResetAccessPassword()
    {
        NvsHelpers::DeleteValue(MISC_CONFIG_NAMESPACE, MISC_CONFIG_ACCESS_PWD);
    }
    bool MiscConfig::isAccessPasswordDefined()
    {
        return GetAccessPassword().length() > 0;
    }
    bool MiscConfig::CheckAccessPassword(const std::string &password)
    {
        if(password.length() > PASSWORD_MAXSIZE) return false;
        const std::string refPassword = GetAccessPassword();
        char ref_pass[PASSWORD_MAXSIZE];
        char provided_pass[PASSWORD_MAXSIZE];
        memset(ref_pass, 0, PASSWORD_MAXSIZE);
        memset(provided_pass, 0, PASSWORD_MAXSIZE);
        memcpy(ref_pass, refPassword.c_str(), refPassword.length() <= PASSWORD_MAXSIZE ? refPassword.length() : PASSWORD_MAXSIZE);
        memcpy(provided_pass, password.c_str(), password.length());
        return constant_time_compare(ref_pass, provided_pass, PASSWORD_MAXSIZE);
    }
    esp_err_t MiscConfig::SetAccessPassword(const std::string &password)
    {
        if (password.length() > PASSWORD_MAXSIZE)
            return ESP_ERR_INVALID_ARG;
        return NvsHelpers::SetString(MISC_CONFIG_NAMESPACE, MISC_CONFIG_ACCESS_PWD, password);
    }
    const std::string MiscConfig::GetAccessPassword()
    {
        std::string pass = CONFIG_CMD_LINE_MANAGEMENT_DEFAULT_PWD;
        NvsHelpers::GetString(MISC_CONFIG_NAMESPACE, MISC_CONFIG_ACCESS_PWD, pass);
        return pass;
    }

    const std::string MiscConfig::GetEffectiveAccessPassword()
    {
        return GetAccessPassword();
    }
}