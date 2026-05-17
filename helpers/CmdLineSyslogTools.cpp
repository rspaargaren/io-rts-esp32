#include "CmdLineManagement.hpp"
#include "SyslogConfig.hpp"
#include "syslog.h"

#include <string.h>
#include "argtable3/argtable3.h"
#include "esp_console.h"
#include "esp_log.h"

using namespace Config;

static const char *TAG = "cmdline_syslog";

static struct
{
    struct arg_lit *read;
    struct arg_lit *del;
    struct arg_int *enabled;
    struct arg_str *server;
    struct arg_int *port;
    struct arg_int *facility;
    struct arg_int *min_level;
    struct arg_end *end;
} config_syslog_args;

static int do_config_syslog_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **)&config_syslog_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, config_syslog_args.end, argv[0]);
        return 1;
    }

    if (config_syslog_args.read->count > 0) {
        ESP_LOGI(TAG, "Syslog status:    %s",     SyslogConfig::isEnabled() ? "enabled" : "disabled");
        ESP_LOGI(TAG, "Server:           %s",     SyslogConfig::GetServer().c_str());
        ESP_LOGI(TAG, "Port:             %u",     SyslogConfig::GetPort());
        ESP_LOGI(TAG, "Facility:         %u",     SyslogConfig::GetFacility());
        ESP_LOGI(TAG, "Min level (sev):  %u",     SyslogConfig::GetMinLevel());
        return 0;
    }

    if (config_syslog_args.del->count > 0) {
        SyslogConfig::DeleteSyslogConfig();
        ESP_LOGI(TAG, "Syslog configuration deleted, defaults restored.");
        syslog_apply_config();
        return 0;
    }

    bool changed = false;

    if (config_syslog_args.enabled->count > 0) {
        SyslogConfig::SetEnabled(config_syslog_args.enabled->ival[0] != 0);
        ESP_LOGI(TAG, "Syslog %s", SyslogConfig::isEnabled() ? "enabled" : "disabled");
        changed = true;
    }
    if (config_syslog_args.server->count > 0) {
        SyslogConfig::SetServer(config_syslog_args.server->sval[0]);
        ESP_LOGI(TAG, "Server set to: %s", SyslogConfig::GetServer().c_str());
        changed = true;
    }
    if (config_syslog_args.port->count > 0) {
        int p = config_syslog_args.port->ival[0];
        if (p < 1 || p > 65535) {
            ESP_LOGE(TAG, "Port must be 1-65535");
        } else {
            SyslogConfig::SetPort((uint16_t)p);
            ESP_LOGI(TAG, "Port set to: %u", SyslogConfig::GetPort());
            changed = true;
        }
    }
    if (config_syslog_args.facility->count > 0) {
        int f = config_syslog_args.facility->ival[0];
        if (f < 0 || f > 23) {
            ESP_LOGE(TAG, "Facility must be 0-23");
        } else {
            SyslogConfig::SetFacility((uint8_t)f);
            ESP_LOGI(TAG, "Facility set to: %u", SyslogConfig::GetFacility());
            changed = true;
        }
    }
    if (config_syslog_args.min_level->count > 0) {
        int l = config_syslog_args.min_level->ival[0];
        if (l < 0 || l > 7) {
            ESP_LOGE(TAG, "Min level must be 0-7 (3=error 4=warn 6=info 7=debug)");
        } else {
            SyslogConfig::SetMinLevel((uint8_t)l);
            ESP_LOGI(TAG, "Min level set to: %u", SyslogConfig::GetMinLevel());
            changed = true;
        }
    }

    if (changed)
        syslog_apply_config();

    return 0;
}

void register_syslog_config_cmdline_tools(void)
{
    config_syslog_args.read      = arg_lit0("r", "read",    "Read current syslog configuration");
    config_syslog_args.del       = arg_lit0("d", "delete",  "Delete syslog configuration (restore defaults)");
    config_syslog_args.enabled   = arg_int0(NULL, "enable", "<0|1>", "1 to enable syslog, 0 to disable");
    config_syslog_args.server    = arg_str0(NULL, "server", "<host>", "Syslog server hostname or IP");
    config_syslog_args.port      = arg_int0(NULL, "port",   "<port>", "UDP port (default 514)");
    config_syslog_args.facility  = arg_int0(NULL, "facility", "<0-23>", "RFC 3164 facility number");
    config_syslog_args.min_level = arg_int0(NULL, "level",  "<0-7>", "Minimum severity: 3=error 4=warn 6=info 7=debug");
    config_syslog_args.end       = arg_end(8);

    const esp_console_cmd_t cmd = {
        .command       = "config_syslog",
        .help          = "Configure remote UDP syslog (RFC 3164)",
        .hint          = NULL,
        .func          = &do_config_syslog_cmd,
        .argtable      = &config_syslog_args,
        .func_w_context = NULL,
        .context       = NULL
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&cmd));
}
