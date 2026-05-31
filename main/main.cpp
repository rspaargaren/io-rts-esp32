#include <stdio.h>
#include <string.h>

#include "HardwareConfig.hpp"
#include "NetworkConfig.hpp"
#include "NetworkHelpers.hpp"
#include "WifiProvision.hpp"
#include "IoRtsManager.hpp"
#include "CmdLineManagement.hpp"
#include "oled_display.h"
#include "web_server.h"

#include "esp_log.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "sdkconfig.h"
#include "esp_console.h"

using namespace Helpers;

// static const char *TAG = "io-rts-esp32";

extern "C" void app_main(void)
{
    // Initialize Hardware: NVS, LittleFS, GPIO ISR, SPI bus
    esp_err_t err = Config::InitHardware();
    ESP_ERROR_CHECK(err);

#if CONFIG_OLED_ENABLED
    ESP_ERROR_CHECK(oled_init());
    oled_show_status("Booting...");
#endif

    // Mark new OTA firmware valid as soon as hardware initialises — prevents
    // rollback when provisioning mode is entered (web server never starts).
    esp_ota_mark_app_valid_cancel_rollback();

    // Check WiFi credentials — branch into provisioning AP if missing
#ifdef CONFIG_CONNECTIVITY_CHOICE_WIFI
    if (!Config::NetworkConfig::HasWifiCredentials())
    {
        ESP_LOGI("main", "WiFi credentials: missing — starting provisioning AP");
        Helpers::WifiProvision::StartAP();
#if CONFIG_OLED_ENABLED
        oled_show_status("WiFi:io-rts-setup");
#endif
        int oled_tick = 0;
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(1000));
#if CONFIG_OLED_ENABLED
            if (++oled_tick >= 3) { oled_tick = 0; oled_show_status("WiFi:io-rts-setup"); }
#endif
        }
    }
    ESP_LOGI("main", "WiFi credentials: found");
#endif

    // Initialize network: Ethernet/Wifi + DHCP/Static IP + SNTP
    NetworkHelpers::InitNetwork();
    vTaskDelay(pdMS_TO_TICKS(5000));

#if CONFIG_OLED_ENABLED
    {
        char ip_str[22] = {};
        const char *netif_keys[] = {"WIFI_STA_DEF", "ETH_DEF", nullptr};
        for (int i = 0; netif_keys[i]; i++) {
            esp_netif_t *netif = esp_netif_get_handle_from_ifkey(netif_keys[i]);
            if (netif) {
                esp_netif_ip_info_t info;
                if (esp_netif_get_ip_info(netif, &info) == ESP_OK && info.ip.addr != 0) {
                    esp_ip4addr_ntoa(&info.ip, ip_str, sizeof(ip_str));
                    break;
                }
            }
        }
        if (ip_str[0]) oled_show_status(ip_str);
    }
#endif

    // Initialize Manager
    IoRts::IoRtsManager ioRtsManager = IoRts::IoRtsManager();

#if CONFIG_WEB_ENABLED
    web_server_start(&ioRtsManager);
#endif

    // Initialize commands line tools
    init_cmdline(&ioRtsManager);

#if CONFIG_OLED_ENABLED
    oled_show_status("Ready");
#endif

    while (true)
        vTaskDelay(pdMS_TO_TICKS(60000));
}