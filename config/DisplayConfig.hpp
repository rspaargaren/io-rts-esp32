#pragma once

#include "esp_err.h"

namespace Config
{
    class DisplayConfig
    {
    public:
        static bool isEnabled();
        static esp_err_t SetEnabled(bool enabled);
    };
}
