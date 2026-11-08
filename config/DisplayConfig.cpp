#include "DisplayConfig.hpp"
#include "NvsHelpers.hpp"

#include <string>

static const std::string DISPLAY_CONFIG_NAMESPACE = "display";
static const std::string DISPLAY_CONFIG_ENABLED = "enabled";

using namespace Helpers;

namespace Config
{
    bool DisplayConfig::isEnabled()
    {
        uint8_t enabled = 1;
        NvsHelpers::GetValue(DISPLAY_CONFIG_NAMESPACE, DISPLAY_CONFIG_ENABLED, enabled);
        return enabled != 0;
    }

    esp_err_t DisplayConfig::SetEnabled(bool enabled)
    {
        const uint8_t value = enabled ? 1 : 0;
        return NvsHelpers::SetValue(DISPLAY_CONFIG_NAMESPACE, DISPLAY_CONFIG_ENABLED, value);
    }
}
