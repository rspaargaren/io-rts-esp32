#include "SyslogConfig.hpp"
#include "NvsHelpers.hpp"
#include "sdkconfig.h"

using namespace Helpers;

static const std::string SYSLOG_NAMESPACE  = "syslog";
static const std::string SYSLOG_ENABLED    = "enabled";
static const std::string SYSLOG_SERVER     = "server";
static const std::string SYSLOG_PORT       = "port";
static const std::string SYSLOG_FACILITY   = "facility";
static const std::string SYSLOG_MIN_LEVEL  = "min_level";

namespace Config
{
    void SyslogConfig::DeleteSyslogConfig()
    {
        NvsHelpers::DeleteValue(SYSLOG_NAMESPACE, SYSLOG_ENABLED);
        NvsHelpers::DeleteValue(SYSLOG_NAMESPACE, SYSLOG_SERVER);
        NvsHelpers::DeleteValue(SYSLOG_NAMESPACE, SYSLOG_PORT);
        NvsHelpers::DeleteValue(SYSLOG_NAMESPACE, SYSLOG_FACILITY);
        NvsHelpers::DeleteValue(SYSLOG_NAMESPACE, SYSLOG_MIN_LEVEL);
    }

    bool SyslogConfig::isEnabled()
    {
#ifdef CONFIG_SYSLOG_ENABLED
        uint8_t enabled = CONFIG_SYSLOG_ENABLED ? 1 : 0;
#else
        uint8_t enabled = 0;
#endif
        NvsHelpers::GetValue(SYSLOG_NAMESPACE, SYSLOG_ENABLED, enabled);
        return enabled != 0;
    }

    esp_err_t SyslogConfig::SetEnabled(bool enabled)
    {
        uint8_t val = enabled ? 0x01 : 0x00;
        return NvsHelpers::SetValue(SYSLOG_NAMESPACE, SYSLOG_ENABLED, val);
    }

    const std::string SyslogConfig::GetServer()
    {
#ifdef CONFIG_SYSLOG_SERVER
        std::string server = CONFIG_SYSLOG_SERVER;
#else
        std::string server = "";
#endif
        NvsHelpers::GetString(SYSLOG_NAMESPACE, SYSLOG_SERVER, server);
        return server;
    }

    esp_err_t SyslogConfig::SetServer(const std::string &server)
    {
        return NvsHelpers::SetString(SYSLOG_NAMESPACE, SYSLOG_SERVER, server);
    }

    uint16_t SyslogConfig::GetPort()
    {
#ifdef CONFIG_SYSLOG_PORT
        uint16_t port = CONFIG_SYSLOG_PORT;
#else
        uint16_t port = 514;
#endif
        NvsHelpers::GetValue(SYSLOG_NAMESPACE, SYSLOG_PORT, port);
        return port;
    }

    esp_err_t SyslogConfig::SetPort(uint16_t port)
    {
        if (port == 0)
            return ESP_ERR_INVALID_ARG;
        return NvsHelpers::SetValue(SYSLOG_NAMESPACE, SYSLOG_PORT, port);
    }

    uint8_t SyslogConfig::GetFacility()
    {
#ifdef CONFIG_SYSLOG_FACILITY
        uint8_t facility = CONFIG_SYSLOG_FACILITY;
#else
        uint8_t facility = 1;
#endif
        NvsHelpers::GetValue(SYSLOG_NAMESPACE, SYSLOG_FACILITY, facility);
        return facility;
    }

    esp_err_t SyslogConfig::SetFacility(uint8_t facility)
    {
        if (facility > 23)
            return ESP_ERR_INVALID_ARG;
        return NvsHelpers::SetValue(SYSLOG_NAMESPACE, SYSLOG_FACILITY, facility);
    }

    uint8_t SyslogConfig::GetMinLevel()
    {
#ifdef CONFIG_SYSLOG_MIN_LEVEL
        uint8_t level = CONFIG_SYSLOG_MIN_LEVEL;
#else
        uint8_t level = 7;
#endif
        NvsHelpers::GetValue(SYSLOG_NAMESPACE, SYSLOG_MIN_LEVEL, level);
        return level;
    }

    esp_err_t SyslogConfig::SetMinLevel(uint8_t level)
    {
        return NvsHelpers::SetValue(SYSLOG_NAMESPACE, SYSLOG_MIN_LEVEL, level);
    }
}
