#pragma once

#include <stdint.h>
#include <stddef.h>
#include "iohome_constants.h"
#include "iohome_frame.hpp"

namespace iohome
{
    constexpr float UNKNOWN_POSITION = 212.0;

    struct IoDeviceInformation
    {
        uint8_t node_id[NODE_ID_SIZE];       // Device node ID
        char name[CMD_PARAM_NAME_MAXSIZE];   // Device Name
        char info1[CMD_PARAM_INFO1_MAXSIZE]; // Device INFO1
        char info2[CMD_PARAM_INFO2_MAXSIZE]; // Device INFO2
        Manufacturer manufacturer;           // Device manufacturer
        DeviceType device_type;              // Device type
        uint8_t device_subtype;              // Device sub-type
    };

    struct IoDevice
    {
        IoDeviceInformation info;             // Device static information (no changes during use)
        float position;                       // Position between 0.0 and 100.0 or UNKNOWN_POSITION if unknown. 0 is open / 0% closed / light on / switch on, 100 is 100% closed / light off / switch off.
        bool is_stopped;                      // true if stopped, false if moving.
        int64_t last_status_timestamp;        // Timestamp of the last received status, in us (use esp_timer_get_time() to fill and compare to local date&time!)
        int64_t next_status_update_timestamp; // Timestamp of the next planned status update, in us (use esp_timer_get_time() to fill and compare to local date&time!)
    };
} // namespace iohome