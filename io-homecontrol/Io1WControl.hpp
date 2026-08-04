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
/// long preamble; the ~40 ms repeat interval is achieved naturally by TX time.
class Io1WControl
{
public:
    /// @param io_home  Existing IoHomeControl instance (must be started).
    /// @param own_node_id  Our controller node ID as a 6-char hex string (e.g. "A1B1C3").
    Io1WControl(IoHomeControl *io_home, const std::string &own_node_id);

    /// @brief Pair a 1W device: generates AES key, sends PAIR (0x2E) then ADD (0x30).
    /// The device must be in pairing mode (prog button held) before calling.
    /// Fills info.key_1w, info.sequence_1w, info.protocol_mode on success.
    bool PairDevice(IoDeviceInformation &info);

    /// @brief Unpair a 1W device: sends REMOVE (0x39).
    bool UnpairDevice(IoDeviceInformation &info);

    /// @brief Send a position command (CMD 0x00) broadcast to all 1W devices of the same type.
    /// position_pct: 0.0 = fully open, 100.0 = fully closed.
    /// Increments info.sequence_1w.
    bool Send(IoDeviceInformation &info, float position_pct);

private:
    void BuildBroadcastTarget(uint8_t dest[NODE_ID_SIZE], DeviceType type) const;
    void TransmitFrame4x(const IoFrame &frame) const;

    IoHomeControl *mIoHome;
    uint8_t        mOwnNodeId[NODE_ID_SIZE];
};

} // namespace iohome
