#include "Io1WControl.hpp"
#include "protocol/iohome_frame.hpp"
#include "protocol/iohome_crypto.h"
#include "protocol/iohome_constants.h"
#include "esp_log.h"
#include "esp_random.h"
#include <cstring>
#include <cmath>

static const char *TAG = "Io1WControl";

namespace iohome
{

Io1WControl::Io1WControl(IoHomeControl *io_home, const std::string &own_node_id)
    : mIoHome(io_home)
{
    memset(mOwnNodeId, 0, NODE_ID_SIZE);
    for (size_t i = 0; i < NODE_ID_SIZE && (i * 2 + 1) < own_node_id.size(); i++)
    {
        char b[3] = {own_node_id[i * 2], own_node_id[i * 2 + 1], 0};
        mOwnNodeId[i] = (uint8_t)strtoul(b, nullptr, 16);
    }
}

void Io1WControl::BuildBroadcastTarget(uint8_t dest[NODE_ID_SIZE], DeviceType type) const
{
    // Broadcast address for all 1W-paired devices of this type: (type << 6) | 0x3F
    uint16_t bcast = (static_cast<uint16_t>(type) << 6) | 0x3F;
    dest[0] = 0x00;
    dest[1] = (uint8_t)(bcast >> 8);
    dest[2] = (uint8_t)(bcast & 0xFF);
}

void Io1WControl::TransmitFrame4x(const IoFrame &frame) const
{
    for (int i = 0; i < 4; i++)
        mIoHome->TransmitFrame(frame, FREQUENCY_CHANNEL_2, LONG_PREAMBLE_LENGTH);
}

bool Io1WControl::PairDevice(IoDeviceInformation &info)
{
    esp_fill_random(info.key_1w, AES_KEY_SIZE);
    info.sequence_1w   = (uint16_t)(esp_random() & 0xFFFF);
    if (info.sequence_1w == 0) info.sequence_1w = 1;
    info.protocol_mode = ProtocolMode::PROTO_1W;

    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    // --- CMD 0x2E (PAIR) ---
    {
        uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
        info.sequence_1w++;

        uint8_t frame_for_hmac[2] = {0x2E, 0x00};
        uint8_t hmac[HMAC_SIZE];
        if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
        {
            ESP_LOGE(TAG, "PairDevice: HMAC failed for PAIR");
            return false;
        }

        // payload: data(0x00) | seq[2] | hmac[6]
        uint8_t params[9];
        params[0] = 0x00;
        params[1] = seq[0]; params[2] = seq[1];
        memcpy(&params[3], hmac, HMAC_SIZE);

        IoFrame frame;
        init_frame(frame, false /*1W*/, true, true, info.is_low_power);
        set_destination(frame, dest);
        set_source(frame, mOwnNodeId);
        set_command(frame, 0x2E, params, sizeof(params));
        TransmitFrame4x(frame);
        ESP_LOGI(TAG, "PairDevice: PAIR (0x2E) sent");
    }

    // --- CMD 0x30 (ADD) ---
    {
        uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
        info.sequence_1w++;

        // Encrypt key using OUR node address as IV (not the device's ID)
        uint8_t enc_key[AES_KEY_SIZE];
        if (!crypto::encrypt_1w_key(mOwnNodeId, info.key_1w, enc_key))
        {
            ESP_LOGE(TAG, "PairDevice: key encryption failed");
            return false;
        }

        // payload: enc_key[16] | manufacturer[1] | data(0x01) | seq[2]
        uint8_t params[20];
        memcpy(params, enc_key, AES_KEY_SIZE);
        params[16] = static_cast<uint8_t>(info.manufacturer);
        params[17] = 0x01;
        params[18] = seq[0]; params[19] = seq[1];

        IoFrame frame;
        init_frame(frame, false /*1W*/, true, true, info.is_low_power);
        set_destination(frame, dest);
        set_source(frame, mOwnNodeId);
        set_command(frame, 0x30, params, sizeof(params));
        TransmitFrame4x(frame);
        ESP_LOGI(TAG, "PairDevice: ADD (0x30) sent");
    }

    return true;
}

bool Io1WControl::UnpairDevice(IoDeviceInformation &info)
{
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
    init_frame(frame, false /*1W*/, true, true, info.is_low_power);
    set_destination(frame, dest);
    set_source(frame, mOwnNodeId);
    set_command(frame, 0x39, params, sizeof(params));
    TransmitFrame4x(frame);
    ESP_LOGI(TAG, "UnpairDevice: REMOVE (0x39) sent");
    return true;
}

bool Io1WControl::Send(IoDeviceInformation &info, float position_pct)
{
    uint8_t dest[NODE_ID_SIZE];
    BuildBroadcastTarget(dest, info.device_type);

    uint8_t seq[2] = {(uint8_t)(info.sequence_1w >> 8), (uint8_t)(info.sequence_1w & 0xFF)};
    info.sequence_1w++;

    // main = position_pct * 512 (0x0000 = fully open, 0xC800 = fully closed)
    uint16_t main_val = (uint16_t)roundf(position_pct * 512.0f);
    uint8_t  origin   = 0x01; // user-initiated
    uint8_t  acei     = 0x43;

    // HMAC covers cmd byte + 5 data bytes preceding seq and hmac
    uint8_t frame_for_hmac[6] = {
        0x00, origin, acei,
        (uint8_t)(main_val >> 8), (uint8_t)(main_val & 0xFF),
        0x00 // fp1
    };
    uint8_t hmac[HMAC_SIZE];
    if (!crypto::create_1w_hmac(frame_for_hmac, sizeof(frame_for_hmac), seq, info.key_1w, hmac))
    {
        ESP_LOGE(TAG, "Send: HMAC failed");
        return false;
    }

    // payload: origin | acei | main[2] | fp1 | seq[2] | hmac[6]  = 13 bytes
    uint8_t params[13];
    params[0] = origin;
    params[1] = acei;
    params[2] = (uint8_t)(main_val >> 8);
    params[3] = (uint8_t)(main_val & 0xFF);
    params[4] = 0x00; // fp1
    params[5] = seq[0]; params[6] = seq[1];
    memcpy(&params[7], hmac, HMAC_SIZE);

    IoFrame frame;
    init_frame(frame, false /*1W*/, true, true, info.is_low_power);
    set_destination(frame, dest);
    set_source(frame, mOwnNodeId);
    set_command(frame, 0x00, params, sizeof(params));
    TransmitFrame4x(frame);
    return true;
}

} // namespace iohome
