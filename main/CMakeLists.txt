idf_component_register(SRCS "cmd_line_management.cpp" "main.cpp" "../io-homecontrol/IoHomeControl.cpp" "../io-homecontrol/protocol/iohome_commands.cpp"
                        "../io-homecontrol/protocol/iohome_crypto.cpp" "../io-homecontrol/protocol/iohome_frame.cpp"
                        "../io-homecontrol/radio/RadioSX1276.cpp"
                    INCLUDE_DIRS "." "../io-homecontrol" "../io-homecontrol/protocol" "../io-homecontrol/radio"
                    REQUIRES esp_timer driver console esp_driver_uart)