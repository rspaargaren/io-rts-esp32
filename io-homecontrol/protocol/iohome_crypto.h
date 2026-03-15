/**
 * @file iohome_crypto.h
 * @brief io-homecontrol Cryptographic Functions
 * @author iown-homecontrol project
 *
 * Cryptographic functions for io-homecontrol protocol including:
 * - AES-128 encryption/decryption
 * - IV (Initial Value) construction
 * - HMAC generation and verification for 2W mode
 */

#pragma once

#include <stdint.h>
#include <stddef.h>
#include "iohome_constants.h"

namespace iohome
{
    namespace crypto
    {

        // ============================================================================
        // Checksum Functions (for IV construction)
        // ============================================================================

        /**
         * @brief Compute custom checksum for IV construction
         *
         * This is a proprietary checksum algorithm used in the IV generation.
         *
         * @param frame_byte Input byte from frame data
         * @param chksum1 First checksum accumulator (in/out)
         * @param chksum2 Second checksum accumulator (in/out)
         */
        void compute_checksum(uint8_t frame_byte, uint8_t &chksum1, uint8_t &chksum2);

        // ============================================================================
        // Initial Value (IV) Construction
        // ============================================================================

        /**
         * @brief Generate a new challenge
         *
         * @param challenge_out Output buffer (6 bytes), allocated by caller
         */
        void generate_challenge(uint8_t challenge_out[HMAC_SIZE]);

        /**
         * @brief Construct Initial Value for 2-Way mode encryption
         *
         * The IV is constructed from:
         * - Bytes 0-7: Frame data (or 0x55 padding)
         * - Bytes 8-9: Custom checksum
         * - Bytes 10-15: Challenge (6 bytes)
         *
         * @param frame_data Pointer to frame data used to build IV (command ID + optional parameters)
         * @param data_len Length of frame data (command ID + optional parameters)
         * @param challenge Challenge bytes (6 bytes)
         * @param iv_out Output buffer for IV (16 bytes)
         */
        void construct_iv_2w(
            const uint8_t *frame_data,
            size_t data_len,
            const uint8_t challenge[HMAC_SIZE],
            uint8_t iv_out[IV_SIZE]);

        // ============================================================================
        // AES-128 Encryption/Decryption
        // ============================================================================

        /**
         * @brief Encrypt a 16-byte block using AES-128 ECB
         *
         * @param input Input data (16 bytes)
         * @param key AES key (16 bytes)
         * @param output Output buffer (16 bytes)
         * @return true on success, false on error
         */
        bool aes128_encrypt(
            const uint8_t input[AES_BLOCK_SIZE],
            const uint8_t key[AES_KEY_SIZE],
            uint8_t output[AES_BLOCK_SIZE]);

        /**
         * @brief Decrypt a 16-byte block using AES-128 ECB
         *
         * @param input Input data (16 bytes)
         * @param key AES key (16 bytes)
         * @param output Output buffer (16 bytes)
         * @return true on success, false on error
         */
        bool aes128_decrypt(
            const uint8_t input[AES_BLOCK_SIZE],
            const uint8_t key[AES_KEY_SIZE],
            uint8_t output[AES_BLOCK_SIZE]);

        // ============================================================================
        // Key Encryption (for pairing)
        // ============================================================================

        /**
         * @brief Encrypt/Decrypt key for 2-Way mode transfer
         *
         * @param frame_data Complete frame data (command ID + optional parameters)
         * @param data_len Length of frame data (command ID + optional parameters)
         * @param challenge Challenge bytes (6 bytes)
         * @param input Input buffer (16 bytes). Key to encrypt or encrypted buffer to decrypt
         * @param output Output buffer (16 bytes). Encrypted key or decrypted key. Allocated by caller.
         * @return true on success, false on error
         */
        bool crypt_2w_key(
            const uint8_t *frame_data,
            size_t data_len,
            const uint8_t challenge[HMAC_SIZE],
            const uint8_t input[AES_KEY_SIZE],
            uint8_t output[AES_KEY_SIZE]);

        // ============================================================================
        // HMAC/MAC
        // ============================================================================

        /**
         * @brief Generate HMAC for 2-Way mode
         *
         * @param frame_data Complete frame data (command ID + optional parameters)
         * @param data_len Length of frame data (command ID + optional parameters)
         * @param challenge Challenge bytes (6 bytes)
         * @param system_key System key (16 bytes)
         * @param hmac_out Output buffer (6 bytes). Allocated by caller.
         * @return true on success, false on error
         */
        bool create_2w_hmac(
            const uint8_t *frame_data,
            size_t data_len,
            const uint8_t challenge[HMAC_SIZE],
            const uint8_t system_key[AES_KEY_SIZE],
            uint8_t hmac_out[HMAC_SIZE]);

        /**
         * @brief Verify HMAC of a received frame
         *
         * @param frame_data Complete frame data (command ID + optional parameters)
         * @param data_len Length of frame data (command ID + optional parameters)
         * @param received_hmac HMAC from frame (6 bytes)
         * @param challenge Challenge bytes (6 bytes)
         * @param system_key System key (16 bytes)
         * @return true if HMAC is valid, false otherwise
         */
        bool verify_hmac(
            const uint8_t *frame_data,
            size_t data_len,
            const uint8_t received_hmac[HMAC_SIZE],
            const uint8_t *challenge,
            const uint8_t system_key[AES_KEY_SIZE]);

    } // namespace crypto
} // namespace iohome
