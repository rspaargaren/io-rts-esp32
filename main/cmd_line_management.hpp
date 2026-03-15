#pragma once

#include "IoHomeControl.hpp"

#ifdef __cplusplus
extern "C" {
#endif

/// @brief Register command line tools
/// @param io_home Pointer to IoHomeControl object
void register_io_cmdline_tools(iohome::IoHomeControl *io_home);

#ifdef __cplusplus
}
#endif