idf_component_register(
    SRCS "esphome_api.cpp"
    INCLUDE_DIRS "."
    REQUIRES esp_netif lwip freertos
    PRIV_REQUIRES esp_timer mqtt nvs_flash espressif__cjson esp_driver_spi esp_driver_gpio
                  mbedtls esp_wifi esp_eth esp_app_format littlefs oled_display web_server
                  espressif__mdns console esp_driver_uart
)

target_include_directories(__idf_esphome_api PRIVATE
    ${CMAKE_SOURCE_DIR}/main
    ${CMAKE_SOURCE_DIR}/helpers
    ${CMAKE_SOURCE_DIR}/config
    ${CMAKE_SOURCE_DIR}/io-homecontrol
    ${CMAKE_SOURCE_DIR}/io-homecontrol/protocol
    ${CMAKE_SOURCE_DIR}/io-homecontrol/radio
)
