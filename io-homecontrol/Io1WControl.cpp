#include "Io1WControl.hpp"
#include "protocol/iohome_frame.hpp"
#include "protocol/iohome_crypto.h"
#include "protocol/iohome_constants.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstring>
#include <cmath>

static const char *TAG = "Io1WControl";

namespace iohome
{

Io1WControl::Io1WControl(IoHomeControl *io_home)
    : mIoHome(io_home)
{
}

void Io1WControl::BuildBroadcastTarget(uint8_t dest[NODE_ID_SIZE], DeviceType) const
{
    // All 1W frames use the global broadcast address. The HMAC selects the device.
    dest[0] = 0x00;
    dest[1] = 0x00;
    dest[2] = 0x3F;
}

void Io1WControl::TransmitFrame4x(const IoFrame &frame) const
{
    // Queue frames one at a time with a 350 ms gap between enqueues.
    // process_radio_task skips its waitTime whenever sTxIoQueue is non-empty,
    // so all 4 frames would be dequeued back-to-back: each Send() calls Standby()
    // which kills the previous frame's preamble after ~1 ms.  The 1024-byte
    // preamble takes ~213 ms to transmit, so we must keep the queue at most 1
    // entry deep until the current transmission is complete.
    for (int i = 0; i < 4; i++)
    {
        mIoHome->TransmitFrame(frame, FREQUENCY_CHANNEL_2, LONG_PREAMBLE_LENGTH);
        if (i < 3)
            vTaskDelay(pdMS_TO_TICKS(350));
    }
}

bool Io1WControl::ReSendPair(IoDeviceInformation &info)
{
    const uint8_t *src = info.node_id;
    const uint8_t dest[NODE_ID_SIZE] = {0x00, 0x00, 0x3F};

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    uint8_t enc_key[AES_KEY_SIZE];
    if (!crypto::encrypt_1w_key(src, info.key_1w, enc_key))
    {
        ESP_LOGE(TAG, "ReSendPair: key encryption failed");
        return false;
    }

    // payload: enc_key[16] | manufacturer[1] | data(0x01) | seq[2] = 20 bytes
    uint8_t params[20];
    memcpy(params, enc_key, AES_KEY_SIZE);
    params[16] = static_cast<uint8_t>(info.manufacturer);
    params[17] = 0x01;
    params[18] = seq[0]; params[19] = seq[1];

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, true);
    set_destination(frame, dest);
    set_source(frame, src);
    set_command(frame, 0x30, params, sizeof(params));
    TransmitFrame4x(frame);
    ESP_LOGI(TAG, "ReSendPair: ADD (0x30) sent from %02X%02X%02X seq=%04X",
             src[0], src[1], src[2], (seq[0] << 8) | seq[1]);
    return true;
}

bool Io1WControl::PairDevice(IoDeviceInformation &info)
{
    esp_fill_random(info.key_1w, AES_KEY_SIZE);
    info.sequence_1w   = (uint16_t)(esp_random() & 0xFFFF);
    if (info.sequence_1w == 0) info.sequence_1w = 1;
    info.protocol_mode = ProtocolMode::PROTO_1W;
    return ReSendPair(info);
}

bool Io1WControl::WinkDevice(IoDeviceInformation &info)
{
    const uint8_t *src = info.node_id;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    uint8_t frame_for_hmac[2] = {0x2E, 0x00};
    uint8_t hmac[HMAC_SIZE];
    if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
    {
        ESP_LOGE(TAG, "WinkDevice: HMAC failed");
        return false;
    }

    uint8_t params[9];
    params[0] = 0x00;
    params[1] = seq[0]; params[2] = seq[1];
    memcpy(&params[3], hmac, HMAC_SIZE);

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, true);
    set_destination(frame, dest);
    set_source(frame, src);
    set_command(frame, 0x2E, params, sizeof(params));
    TransmitFrame4x(frame);
    ESP_LOGI(TAG, "WinkDevice: DISCOVER (0x2E) sent from %02X%02X%02X seq=%04X",
             src[0], src[1], src[2], (seq[0] << 8) | seq[1]);
    return true;
}

bool Io1WControl::UnpairDevice(IoDeviceInformation &info)
{
    const uint8_t *src = info.node_id;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    uint8_t frame_for_hmac[2] = {0x39, 0x00};
    uint8_t hmac[HMAC_SIZE];
    if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
    {
        ESP_LOGE(TAG, "UnpairDevice: HMAC failed");
        return false;
    }

    uint8_t params[9];
    params[0] = 0x00;
    params[1] = seq[0]; params[2] = seq[1];
    memcpy(&params[3], hmac, HMAC_SIZE);

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, true);
    set_destination(frame, dest);
    set_source(frame, src);
    set_command(frame, 0x39, params, sizeof(params));
    TransmitFrame4x(frame);
    ESP_LOGI(TAG, "UnpairDevice: REMOVE (0x39) sent");
    return true;
}

bool Io1WControl::Send(IoDeviceInformation &info, float position_pct)
{
    const uint8_t *src = info.node_id;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    // main = position_pct * 512 (0x0000 = fully open, 0xC800 = fully closed)
    uint16_t main_val = (uint16_t)roundf(position_pct * 512.0f);
    uint8_t  origin   = 0x01;
    uint8_t  acei     = 0x43;

    uint8_t frame_for_hmac[7] = {
        0x00, origin, acei,
        (uint8_t)(main_val >> 8), (uint8_t)(main_val & 0xFF),
        0x00, 0x00
    };
    uint8_t hmac[HMAC_SIZE];
    if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
    {
        ESP_LOGE(TAG, "Send: HMAC failed");
        return false;
    }

    // payload: origin | acei | main[2] | fp1 | fp2 | seq[2] | hmac[6] = 14 bytes
    uint8_t params[14];
    params[0] = origin;
    params[1] = acei;
    params[2] = (uint8_t)(main_val >> 8);
    params[3] = (uint8_t)(main_val & 0xFF);
    params[4] = 0x00;
    params[5] = 0x00;
    params[6] = seq[0]; params[7] = seq[1];
    memcpy(&params[8], hmac, HMAC_SIZE);

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, true);
    set_destination(frame, dest);
    set_source(frame, src);
    set_command(frame, 0x00, params, sizeof(params));
    TransmitFrame4x(frame);
    return true;
}

bool Io1WControl::Stop(IoDeviceInformation &info)
{
    const uint8_t *src = info.node_id;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    constexpr uint16_t STOP_VAL = 0xD200;
    uint8_t  origin = 0x01;
    uint8_t  acei   = 0x43;

    uint8_t frame_for_hmac[7] = {
        0x00, origin, acei,
        (uint8_t)(STOP_VAL >> 8), (uint8_t)(STOP_VAL & 0xFF),
        0x00, 0x00
    };
    uint8_t hmac[HMAC_SIZE];
    if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
    {
        ESP_LOGE(TAG, "Stop: HMAC failed");
        return false;
    }

    uint8_t params[14];
    params[0] = origin;
    params[1] = acei;
    params[2] = (uint8_t)(STOP_VAL >> 8);
    params[3] = (uint8_t)(STOP_VAL & 0xFF);
    params[4] = 0x00;
    params[5] = 0x00;
    params[6] = seq[0]; params[7] = seq[1];
    memcpy(&params[8], hmac, HMAC_SIZE);

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, true);
    set_destination(frame, dest);
    set_source(frame, src);
    set_command(frame, 0x00, params, sizeof(params));
    TransmitFrame4x(frame);
    return true;
}

} // namespace iohome
