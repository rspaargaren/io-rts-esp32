#pragma once
#include "sdkconfig.h"
#ifdef __cplusplus
extern "C" {
#endif

void esphome_api_start(void *io_rts_manager);

// Called by IoRtsManager when a device's position or movement state changes.
// position: 0.0–100.0 (percentage open), is_moving: true while travelling
void esphome_api_notify_cover_state(const char *device_id, float position, bool is_moving);

// Called when a device is removed from mIoDevices.
void esphome_api_notify_cover_removed(const char *device_id);

#ifdef __cplusplus
}
#endif
