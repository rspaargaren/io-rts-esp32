#pragma once

#include "IoRtsManager.hpp"

#ifdef __cplusplus
extern "C"
{
#endif

    /// @brief Register misc. command line tools (like reboot)
    void register_misc_cmdline_tools();

    /// @brief Register network configuration command line tools (Wifi, DHCP, static IPv4, DNS and SNTP configuration)
    void register_network_config_cmdline_tools();

    /// @brief Register MQTT configuration command line tools
    void register_mqtt_config_cmdline_tools();

    /// @brief Register command line tools
    /// @param io_rts_manager Pointer to IoRtsManager object
    void register_io_cmdline_tools(IoRts::IoRtsManager *io_rts_manager);

#ifdef __cplusplus
}
#endif