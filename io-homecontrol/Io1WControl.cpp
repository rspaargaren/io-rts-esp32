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

// cridp/iohcRemote1W always uses ACEI 0x43 on cmd 0x00 (see old/src/iohcRemote1W.cpp).
// Physical OEM remotes may show 0x61 on-air; motors paired via this stack expect 0x43.
static constexpr uint8_t ACEI_1W_EXECUTE = 0x43;

uint8_t BroadcastRouteTypnFor1W(DeviceType device_type)
{
    switch (device_type)
    {
    case DeviceType::WINDOW_OPENER:
    case DeviceType::VENTILATION_POINT:
        return 2; // 00:00:BF (Velux window / ventilation pairing route)
    case DeviceType::ROLLER_SHUTTER:
    case DeviceType::AWNING:
    case DeviceType::BLIND:
    case DeviceType::VENETIAN_BLIND:
    case DeviceType::EXTERNAL_VENETIAN_BLIND:
    case DeviceType::LOUVRE_BLIND:
    case DeviceType::SWINGING_SHUTTER:
    case DeviceType::DUAL_SHUTTER:
    case DeviceType::HORIZONTAL_AWNING:
    case DeviceType::CURTAIN_TRACK:
        return 3; // 00:00:FF (shutter / blind pairing route)
    default:
        return 0; // 00:00:3F (cridp default — all types)
    }
}

Io1WControl::Io1WControl(IoHomeControl *io_home)
    : mIoHome(io_home)
{
}

void Io1WControl::BuildBroadcastTarget(uint8_t dest[NODE_ID_SIZE], const IoDeviceInformation &info) const
{
    // cridp forgePacket: target = (typn << 6) | 0x3F; typn stored as device_subtype / JSON "type"[0].
    const uint16_t bcast = (static_cast<uint16_t>(info.device_subtype) << 6) | 0x3Fu;
    dest[0] = 0x00;
    dest[1] = static_cast<uint8_t>(bcast >> 8);
    dest[2] = static_cast<uint8_t>(bcast & 0xFF);
}

void Io1WControl::TransmitFrame4x(const IoFrame &frame) const
{
    // cridp: 4 repeats, 40 ms apart; first burst uses long preamble, repeats short.
    // Space enqueues so the long preamble (~200 ms+) can finish before the next TX.
    static constexpr int kRepeatGapMs = 40;
    static constexpr int kAfterLongPreambleMs = 280;

    for (int i = 0; i < 4; i++)
    {
        const uint16_t preamble =
            (i == 0) ? LONG_PREAMBLE_LENGTH : SHORT_PREAMBLE_LENGTH;
        mIoHome->TransmitFrame(frame, FREQUENCY_CHANNEL_2, preamble);
        if (i < 3)
            vTaskDelay(pdMS_TO_TICKS(i == 0 ? kAfterLongPreambleMs : kRepeatGapMs));
    }
}

bool Io1WControl::ReSendPair(IoDeviceInformation &info)
{
    const uint8_t *src = info.node_id;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info);

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
    ESP_LOGI(TAG,
             "ReSendPair: ADD (0x30) from %02X%02X%02X to %02X%02X%02X typn=%u man=0x%02X seq=%04X",
             src[0], src[1], src[2], dest[0], dest[1], dest[2],
             info.device_subtype, params[16], (seq[0] << 8) | seq[1]);
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
    BuildBroadcastTarget(dest, info);

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
    BuildBroadcastTarget(dest, info);

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
    BuildBroadcastTarget(dest, info);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    // main = position_pct * 512 (0x0000 = fully open, 0xC800 = fully closed)
    uint16_t main_val = (uint16_t)roundf(position_pct * 512.0f);
    uint8_t  origin   = 0x01;
    uint8_t  acei     = ACEI_1W_EXECUTE;

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
    BuildBroadcastTarget(dest, info);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    constexpr uint16_t STOP_VAL = 0xD200;
    uint8_t  origin = 0x01;
    uint8_t  acei   = ACEI_1W_EXECUTE;

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
