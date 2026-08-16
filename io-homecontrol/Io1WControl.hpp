#pragma once

#include <string>
#include "IoHomeControl.hpp"
#include "protocol/iohome_device.hpp"

namespace iohome
{

/// @brief Simplex (1W) device controller.
///
/// Builds and transmits 1W io-homecontrol frames by calling TransmitFrame on an
/// existing IoHomeControl instance. Each command is sent 4 times on CH2 with a
/// long preamble (LPM=1). The source address in every frame is info.node_id —
/// each 1W device has its own virtual remote address, matching cridp's design.
class Io1WControl
{
public:
    /// @param io_home  Existing IoHomeControl instance (must be started).
    explicit Io1WControl(IoHomeControl *io_home);

    /// @brief Pair a 1W device: generates a fresh AES key and sends ADD (0x30).
    /// The device must be in pairing mode before calling.
    /// Fills info.key_1w, info.sequence_1w, info.protocol_mode on success.
    bool PairDevice(IoDeviceInformation &info);

    /// @brief Resend the ADD (0x30) frame using the already-stored key.
    /// Use when the device missed the initial pairing frame; put the device in
    /// pairing mode again then call this — no new key is generated.
    bool ReSendPair(IoDeviceInformation &info);

    /// @brief Wink a 1W device: sends DISCOVER (0x2E) from this already-paired remote.
    /// The device verifies the HMAC and enters pairing acceptance mode so that
    /// another remote can pair without a physical button press.
    bool WinkDevice(IoDeviceInformation &info);

    /// @brief Unpair a 1W device: sends REMOVE (0x39).
    bool UnpairDevice(IoDeviceInformation &info);

    /// @brief Send a position command (CMD 0x00) to the device.
    /// position_pct: 0.0 = fully open, 100.0 = fully closed.
    /// Increments info.sequence_1w.
    bool Send(IoDeviceInformation &info, float position_pct);

    /// @brief Send a stop command (CMD 0x00, main=0xD200).
    /// Increments info.sequence_1w.
    bool Stop(IoDeviceInformation &info);

private:
    void BuildBroadcastTarget(uint8_t dest[NODE_ID_SIZE], DeviceType type) const;
    void TransmitFrame4x(const IoFrame &frame) const;

    IoHomeControl *mIoHome;
};

} // namespace iohome
