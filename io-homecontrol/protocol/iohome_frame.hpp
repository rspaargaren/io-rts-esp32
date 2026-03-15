/**
 * @file iohome_frame.h
 * @brief io-homecontrol Frame Construction and Parsing
 * @author iown-homecontrol project
 *
 * Functions for constructing and parsing io-homecontrol protocol frames.
 */

#pragma once

#include <stdint.h>
#include <stddef.h>
#include "iohome_constants.h"

namespace iohome
{

  // ============================================================================
  // Frame Structure
  // ============================================================================

  /**
   * @brief io-homecontrol Frame structure
   */
  struct IoFrame
  {
    // Control Bytes
    uint8_t ctrl_byte_0; // Order, Protocol Mode, Frame Length (1 byte)
    uint8_t ctrl_byte_1; // Beacon, Routed, Low Power, ACK, Version (1 byte)

    // Addresses
    uint8_t dest_node[NODE_ID_SIZE]; // Destination Node ID (3 bytes)
    uint8_t src_node[NODE_ID_SIZE];  // Source Node ID (3 bytes)

    // Command and Data
    uint8_t command_id;                // Command ID (1 byte)
    uint8_t data[FRAME_MAX_DATA_SIZE]; // Parameters (0-23 bytes)
    uint8_t data_len;                  // Actual length of data
  };

  // ============================================================================
  // Frame Construction
  // ============================================================================

  /// @brief Initialize a frame with default values
  /// @param frame IoFrame structure to initialize
  /// @param is_2w Initialize the frame with '1W/2W' flag in CTRL0
  /// @param is_start Initialize the frame with 'start' flag in CTRL0
  /// @param is_end Initialize the frame with 'end' flag in CTRL0
  /// @param is_lowPower Initialize the frame with 'lowPower' flag in CTRL1
  void init_frame(IoFrame &frame, bool is_2w = true, bool is_start = false, bool is_end = false, bool is_lowPower = false);

  /**
   * @brief Set destination node address
   * @param frame IoFrame structure
   * @param node_id Node ID (3 bytes)
   */
  void set_destination(IoFrame &frame, const uint8_t node_id[NODE_ID_SIZE]);

  /**
   * @brief Set source node address
   * @param frame IoFrame structure
   * @param node_id Node ID (3 bytes)
   */
  void set_source(IoFrame &frame, const uint8_t node_id[NODE_ID_SIZE]);

  /**
   * @brief Set command ID and parameters
   * @param frame IoFrame structure
   * @param cmd_id Command ID
   * @param params Pointer to parameter data (can be nullptr if no data to add, up to 23 bytes)
   * @param params_len Length of parameter data, value must be in range 0-23 bytes
   * @return true on success, false if params_len too large
   */
  bool set_command(IoFrame &frame, uint8_t cmd_id, const uint8_t *params = nullptr, size_t params_len = 0);

  /**
   * @brief Serialize frame to byte buffer
   * @param frame IoFrame structure
   * @param buffer Output buffer, must be allocated by caller
   * @param buffer_size Size of output buffer (number of bytes available for copy to buffer)
   * @return Number of bytes written, or 0 on error (buffer too short)
   */
  size_t serialize_frame(const IoFrame &frame, uint8_t *buffer, size_t buffer_size);

  // ============================================================================
  // Frame Parsing
  // ============================================================================

  /**
   * @brief Parse a received frame from byte buffer
   * @param buffer Input buffer containing RAW frame to parse
   * @param buffer_len Length of input buffer
   * @param frame Output IoFrame structure
   * @return true on success, false on parse error
   */
  bool parse_frame(const uint8_t *buffer, size_t buffer_len, IoFrame &frame);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * @brief Get frame length from IoFrame
   * @param frame IoFrame structure
   * @return Frame length (9-32 bytes)
   */
  inline uint8_t get_frame_length(const IoFrame &frame)
  {
    return (frame.ctrl_byte_0 & CTRL0_LENGTH_MASK) + 1; // Control byte 0 not included in CTRL0_LENGTH_MASK so add 1
  }

  /// @brief Get 'start' flag value from IoFrame
  /// @param frame IoFrame structure
  /// @return true if 'start' flag is set, false otherwise
  inline bool is_start(const IoFrame &frame)
  {
    return (frame.ctrl_byte_0 & CTRL0_START) != 0x00;
  }

  /// @brief Get 'end' flag value from IoFrame
  /// @param frame IoFrame structure
  /// @return true if 'end' flag is set, false otherwise
  inline bool is_end(const IoFrame &frame)
  {
    return (frame.ctrl_byte_0 & CTRL0_END) != 0;
  }

  /**
   * @brief Get protocol mode (1W/2W) from IoFrame
   * @param frame IoFrame structure
   * @return true if 2W mode, false if 1W mode
   */
  inline bool is_2w_mode(const IoFrame &frame)
  {
    return (frame.ctrl_byte_0 & CTRL0_PROTOCOL_MASK) == 0;
  }

} // namespace iohome
