/**
 * @file iohome_frame.cpp
 * @brief io-homecontrol Frame Construction and Parsing Implementation
 * @author iown-homecontrol project
 */

#include "iohome_frame.hpp"
#include "iohome_crypto.h"
#include "esp_log.h"

static const char *TAG = "io-hframe";

namespace iohome
{
  // ============================================================================
  // Frame Construction
  // ============================================================================

  void init_frame(IoFrame &frame, bool is_2w, bool is_start, bool is_end, bool is_lowPower)
  {
    memset(&frame, 0, sizeof(IoFrame));

    // Set default control bytes
    frame.ctrl_byte_0 = 0x00; // Will be updated when data is set
    frame.ctrl_byte_1 = 0x00; // Default: no beacon, not routed, no ack, no protocol version

    // CTRL 0
    if (is_end)
      frame.ctrl_byte_0 |= CTRL0_END; // Set End bit
    if (is_start)
      frame.ctrl_byte_0 |= CTRL0_START; // Set Start bit
    if (!is_2w)
      frame.ctrl_byte_0 |= CTRL0_PROTOCOL_MODE_1W; // Set 1W bit

    // CTRL 1
    if (is_lowPower)
      frame.ctrl_byte_1 |= CTRL1_LOW_POWER; // Set LowPower bit
  }

  void set_destination(IoFrame &frame, const uint8_t node_id[NODE_ID_SIZE])
  {
    memcpy(frame.dest_node, node_id, NODE_ID_SIZE);
  }

  void set_source(IoFrame &frame, const uint8_t node_id[NODE_ID_SIZE])
  {
    memcpy(frame.src_node, node_id, NODE_ID_SIZE);
  }

  bool set_command(IoFrame &frame, uint8_t cmd_id, const uint8_t *params, size_t params_len)
  {
    if (params_len > FRAME_MAX_DATA_SIZE)
    {
      return false; // Parameters too large
    }

    frame.command_id = cmd_id;
    frame.data_len = params_len;

    if (params != nullptr && params_len > 0)
    {
      memcpy(frame.data, params, params_len);
    }

    // Update control byte 0 with frame length
    // total_length = FRAME_MIN_SIZE (CTRL_BYTE_0 + CTRL_BYTE_1 + DST + SRC + CMD) + data_len
    uint8_t total_length = FRAME_MIN_SIZE + frame.data_len;

    // Update ctrl_byte_0 length field = total_length - CTRL_BYTE_0
    frame.ctrl_byte_0 = (frame.ctrl_byte_0 & ~CTRL0_LENGTH_MASK) | ((total_length - 1) & CTRL0_LENGTH_MASK);

    return true;
  }

  size_t serialize_frame(const IoFrame &frame, uint8_t *buffer, size_t buffer_size)
  {
    if (buffer_size < get_frame_length(frame))
    {
      return 0; // Buffer too small
    }

    size_t offset = 0;

    // Control Bytes
    buffer[offset++] = frame.ctrl_byte_0;
    buffer[offset++] = frame.ctrl_byte_1;

    // Destination Node
    memcpy(&buffer[offset], &frame.dest_node, NODE_ID_SIZE);
    offset += NODE_ID_SIZE;

    // Source Node
    memcpy(&buffer[offset], &frame.src_node, NODE_ID_SIZE);
    offset += NODE_ID_SIZE;

    // Command ID
    buffer[offset++] = frame.command_id;

    // Parameters
    memcpy(&buffer[offset], &frame.data, frame.data_len);
    offset += frame.data_len;

    return offset;
  }

  // ============================================================================
  // Frame Parsing
  // ============================================================================

  bool parse_frame(const uint8_t *buffer, size_t buffer_len, IoFrame &frame)
  {
    if (buffer_len < FRAME_MIN_SIZE)
    {
      ESP_LOGE(TAG, "parse_frame Error: buffer_len %d", buffer_len);
      return false; // Frame too short
    }

    memset(&frame, 0, sizeof(IoFrame));

    size_t offset = 0;

    // Parse Control Bytes
    frame.ctrl_byte_0 = buffer[offset++];
    frame.ctrl_byte_1 = buffer[offset++];

    // Get frame length
    uint8_t frame_length = get_frame_length(frame);

    if (buffer_len < frame_length)
    {
      ESP_LOGE(TAG, "parse_frame Error: buffer_len %d ; frame_length %d", buffer_len, frame_length);
      return false; // Buffer doesn't contain complete frame
    }

    // Parse Destination Node
    memcpy(frame.dest_node, &buffer[offset], NODE_ID_SIZE);
    offset += NODE_ID_SIZE;

    // Parse Source Node
    memcpy(frame.src_node, &buffer[offset], NODE_ID_SIZE);
    offset += NODE_ID_SIZE;

    // Parse Command ID
    frame.command_id = buffer[offset++];

    // Calculate data length
    frame.data_len = frame_length - FRAME_MIN_SIZE; // ctrl_byte_0 + ctrl_byte_1 + DST + SRC + CMD

    if (frame.data_len > FRAME_MAX_DATA_SIZE)
    {
      ESP_LOGE(TAG, "parse_frame Error: buffer_len %d, frame_length %d, data_len %d", buffer_len, frame_length, frame.data_len);
      return false; // Invalid data length
    }

    // Parse Parameters
    memcpy(frame.data, &buffer[offset], frame.data_len);
    offset += frame.data_len;

    return true;
  }

} // namespace iohome
