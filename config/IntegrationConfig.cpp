#include "IntegrationConfig.hpp"
#include "NvsHelpers.hpp"

static const std::string NS  = "misc";
static const std::string KEY = "integration";

namespace Config
{
    std::string IntegrationConfig::GetMode()
    {
        std::string mode = "mqtt"; // default — preserves existing MQTT behaviour on upgrade
        Helpers::NvsHelpers::GetString(NS, KEY, mode);
        return mode;
    }

    esp_err_t IntegrationConfig::SetMode(const std::string &mode)
    {
        return Helpers::NvsHelpers::SetString(NS, KEY, mode);
    }
}
