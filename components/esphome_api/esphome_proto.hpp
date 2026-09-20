#pragma once
#include <stdint.h>
#include <string.h>
#include <vector>

// ── ProtoWriter ──────────────────────────────────────────────────────────────
class ProtoWriter {
    std::vector<uint8_t> buf_;

    void push_varint(uint64_t v) {
        do {
            uint8_t b = v & 0x7F;
            v >>= 7;
            buf_.push_back(v ? (b | 0x80) : b);
        } while (v);
    }
    void push_tag(uint32_t field, uint32_t wire) { push_varint((uint64_t(field) << 3) | wire); }

public:
    void write_varint(uint32_t field, uint64_t v) { push_tag(field, 0); push_varint(v); }
    void write_bool(uint32_t field, bool v)        { write_varint(field, v ? 1 : 0); }
    void write_fixed32(uint32_t field, uint32_t v) {
        push_tag(field, 5);
        buf_.push_back(v & 0xFF); buf_.push_back((v >> 8) & 0xFF);
        buf_.push_back((v >> 16) & 0xFF); buf_.push_back((v >> 24) & 0xFF);
    }
    void write_float(uint32_t field, float v) {
        uint32_t bits; memcpy(&bits, &v, 4); write_fixed32(field, bits);
    }
    void write_string(uint32_t field, const char *s) {
        if (!s) s = "";
        size_t len = strlen(s);
        push_tag(field, 2); push_varint(len);
        for (size_t i = 0; i < len; i++) buf_.push_back((uint8_t)s[i]);
    }
    const uint8_t *data() const { return buf_.empty() ? nullptr : buf_.data(); }
    size_t         size() const { return buf_.size(); }
    void           clear()      { buf_.clear(); }
};

// ── ProtoReader ──────────────────────────────────────────────────────────────
class ProtoReader {
    const uint8_t *p_;
    const uint8_t *end_;
    bool ok_ = true;

public:
    ProtoReader(const uint8_t *data, size_t len) : p_(data), end_(data + len) {}

    bool ok() const { return ok_ && p_ <= end_; }

    bool read_varint(uint64_t *out) {
        uint64_t result = 0; int shift = 0;
        while (p_ < end_) {
            uint8_t b = *p_++;
            result |= uint64_t(b & 0x7F) << shift;
            if (!(b & 0x80)) { *out = result; return true; }
            shift += 7;
            if (shift >= 64) break;
        }
        return ok_ = false;
    }

    bool read_tag(uint32_t *field, uint32_t *wire) {
        if (p_ >= end_) return false;
        uint64_t tag; if (!read_varint(&tag)) return false;
        *field = uint32_t(tag >> 3); *wire = uint32_t(tag & 7);
        return true;
    }

    bool read_fixed32(uint32_t *out) {
        if (end_ - p_ < 4) return ok_ = false;
        *out = uint32_t(p_[0]) | (uint32_t(p_[1]) << 8) | (uint32_t(p_[2]) << 16) | (uint32_t(p_[3]) << 24);
        p_ += 4; return true;
    }

    bool read_string(char *out, size_t max_len) {
        uint64_t len; if (!read_varint(&len)) return false;
        if (len > (size_t)(end_ - p_)) return ok_ = false;
        size_t copy = (len < max_len - 1) ? len : max_len - 1;
        memcpy(out, p_, copy); out[copy] = '\0'; p_ += len; return true;
    }

    bool skip(uint32_t wire) {
        if (wire == 0) { uint64_t v; return read_varint(&v); }
        if (wire == 5) { uint32_t v; return read_fixed32(&v); }
        if (wire == 2) {
            uint64_t len; if (!read_varint(&len)) return false;
            if (len > (size_t)(end_ - p_)) return ok_ = false;
            p_ += len; return true;
        }
        return ok_ = false;
    }

    bool at_end() const { return p_ >= end_; }
};
