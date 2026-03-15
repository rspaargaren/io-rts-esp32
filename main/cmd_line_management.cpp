#include "cmd_line_management.hpp"

#include <stdio.h>
#include <string.h>
#include "argtable3/argtable3.h"
#include "esp_console.h"
#include "esp_log.h"

static const char *TAG = "cmdline_mngt";
static iohome::IoHomeControl *sIoHome;

// ******************* IO DISCOVER ********************

static int do_iodiscover_cmd(int argc, char **argv)
{
    if(!sIoHome->DiscoverAndPairDevice())
    {
        ESP_LOGW(TAG, "Discover failed");
    }
    return 0;
}

static void register_iodiscover(void)
{
    const esp_console_cmd_t iodiscover_cmd = {
        .command = "io_discover",
        .help = "Try to find and pair an IO-HomeControl device in pairing mode and never registered",
        .hint = NULL,
        .func = &do_iodiscover_cmd,
        .argtable = NULL,
        .func_w_context = NULL,
        .context = NULL
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&iodiscover_cmd));
}

// ******************* IO ADD ********************

/// @brief Structure used by the 'io_add' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} ioadd_args;

static int do_ioadd_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &ioadd_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, ioadd_args.end, argv[0]);
        return 1;
    }
    sIoHome->AddDevice(ioadd_args.device_id->sval[0]);
    return 0;
}

void register_ioadd(void)
{
    ioadd_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    ioadd_args.end = arg_end(1);

    const esp_console_cmd_t ioadd_cmd = {
        .command = "io_add",
        .help = "Add an already registered IO-HomeControl device",
        .hint = NULL,
        .func = &do_ioadd_cmd,
        .argtable = &ioadd_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&ioadd_cmd) );
}

// ******************* IO OPEN ********************

/// @brief Structure used by the 'io_open' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} ioopen_args;

static int do_ioopen_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &ioopen_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, ioopen_args.end, argv[0]);
        return 1;
    }
    sIoHome->OpenDevice(ioopen_args.device_id->sval[0]);
    return 0;
}

void register_ioopen(void)
{
    ioopen_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    ioopen_args.end = arg_end(1);

    const esp_console_cmd_t ioopen_cmd = {
        .command = "io_open",
        .help = "Open (or set to 'On') an IO-HomeControl device",
        .hint = NULL,
        .func = &do_ioopen_cmd,
        .argtable = &ioopen_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&ioopen_cmd) );
}

// ******************* IO CLOSE ********************

/// @brief Structure used by the 'io_close' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} ioclose_args;

static int do_ioclose_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &ioclose_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, ioclose_args.end, argv[0]);
        return 1;
    }
    sIoHome->CloseDevice(ioclose_args.device_id->sval[0]);
    return 0;
}

void register_ioclose(void)
{
    ioclose_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    ioclose_args.end = arg_end(1);

    const esp_console_cmd_t ioclose_cmd = {
        .command = "io_close",
        .help = "Close (or set to 'Off') an IO-HomeControl device",
        .hint = NULL,
        .func = &do_ioclose_cmd,
        .argtable = &ioclose_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&ioclose_cmd) );
}

// ******************* IO STOP ********************

/// @brief Structure used by the 'io_stop' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} iostop_args;

static int do_iostop_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &iostop_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, iostop_args.end, argv[0]);
        return 1;
    }
    sIoHome->StopDevice(iostop_args.device_id->sval[0]);
    return 0;
}

void register_iostop(void)
{
    iostop_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    iostop_args.end = arg_end(1);

    const esp_console_cmd_t iostop_cmd = {
        .command = "io_stop",
        .help = "Stop a currently moving IO-HomeControl device",
        .hint = NULL,
        .func = &do_iostop_cmd,
        .argtable = &iostop_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&iostop_cmd) );
}

// ******************* IO FAVORITE POSITION ********************

/// @brief Structure used by the 'io_setfavpos' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} iosetfavpos_args;

static int do_iosetfavpos_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &iosetfavpos_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, iosetfavpos_args.end, argv[0]);
        return 1;
    }
    sIoHome->SetDeviceToFavoritePosition(iosetfavpos_args.device_id->sval[0]);
    return 0;
}

void register_iosetfavpos(void)
{
    iosetfavpos_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    iosetfavpos_args.end = arg_end(1);

    const esp_console_cmd_t iosetfavpos_cmd = {
        .command = "io_setfavpos",
        .help = "Set an IO-HomeControl device to favorite position (like 'My' button)",
        .hint = NULL,
        .func = &do_iosetfavpos_cmd,
        .argtable = &iosetfavpos_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&iosetfavpos_cmd) );
}

// ******************* IO SET POSITION ********************

/// @brief Structure used by the 'io_setpos' command
static struct {
    struct arg_str *device_id;
    struct arg_int *position;
    struct arg_end *end;
} iosetpos_args;

static int do_iosetpos_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &iosetpos_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, iosetpos_args.end, argv[0]);
        return 1;
    }
    if (iosetpos_args.position->ival[0] >= 0 && iosetpos_args.position->ival[0] <= 100)
    {
        sIoHome->SetDevicePosition(iosetpos_args.device_id->sval[0], iosetpos_args.position->ival[0]);
    }
    else ESP_LOGE(TAG, "Invalid value for <position>");
    return 0;
}

void register_iosetpos(void)
{
    iosetpos_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    iosetpos_args.position = arg_int1(NULL, NULL, "<position>", "Specify the position to reach (0 = OPEN to 100 = CLOSED)");
    iosetpos_args.end = arg_end(2);

    const esp_console_cmd_t iosetpos_cmd = {
        .command = "io_setpos",
        .help = "Set an IO-HomeControl device to a specified position",
        .hint = NULL,
        .func = &do_iosetpos_cmd,
        .argtable = &iosetpos_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&iosetpos_cmd) );
}

// ******************* IO FORCE STATUS UPDATE ********************

/// @brief Structure used by the 'io_update' command
static struct {
    struct arg_str *device_id;
    struct arg_end *end;
} ioupdate_args;

static int do_ioupdate_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &ioupdate_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, ioupdate_args.end, argv[0]);
        return 1;
    }
    sIoHome->ForceDeviceStatusUpdate(ioupdate_args.device_id->sval[0]);
    return 0;
}

void register_ioupdate(void)
{
    ioupdate_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    ioupdate_args.end = arg_end(1);

    const esp_console_cmd_t ioupdate_cmd = {
        .command = "io_update",
        .help = "Force status update for a given IO-HomeControl device",
        .hint = NULL,
        .func = &do_ioupdate_cmd,
        .argtable = &ioupdate_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&ioupdate_cmd) );
}

// ******************* IO SET NAME ********************

/// @brief Structure used by the 'io_setname' command
static struct {
    struct arg_str *device_id;
    struct arg_str *device_name;
    struct arg_end *end;
} iosetname_args;

static int do_iosetname_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &iosetname_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, iosetname_args.end, argv[0]);
        return 1;
    }
    sIoHome->SetDeviceName(iosetname_args.device_id->sval[0], iosetname_args.device_name->sval[0]);
    return 0;
}

void register_iosetname(void)
{
    iosetname_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    iosetname_args.device_name = arg_str1(NULL, NULL, "<name>", "Name of the device, 1 to 15 characters");
    iosetname_args.end = arg_end(2);

    const esp_console_cmd_t iosetname_cmd = {
        .command = "io_setname",
        .help = "Set a new name inside IO-HomeControl device configuration",
        .hint = NULL,
        .func = &do_iosetname_cmd,
        .argtable = &iosetname_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&iosetname_cmd) );
}

// ******************* IO LINK REMOTE ********************

/// @brief Structure used by the 'io_linkremote' command
static struct {
    struct arg_str *device_id;
    struct arg_str *remote_id;
    struct arg_end *end;
} iolinkremote_args;

static int do_iolinkremote_cmd(int argc, char **argv)
{
    int nerrors = arg_parse(argc, argv, (void **) &iolinkremote_args);
    if (nerrors != 0) {
        arg_print_errors(stderr, iolinkremote_args.end, argv[0]);
        return 1;
    }
    sIoHome->LinkRemoteToDevice(iolinkremote_args.remote_id->sval[0], iolinkremote_args.device_id->sval[0]);
    return 0;
}

void register_iolinkremote(void)
{
    iolinkremote_args.device_id = arg_str1(NULL, NULL, "<deviceid>", "ID of the device, 3 bytes (eg 112233)");
    iolinkremote_args.remote_id = arg_str1(NULL, NULL, "<remoteid>", "ID of the remote, 3 bytes (eg AABBCC)");
    iolinkremote_args.end = arg_end(2);

    const esp_console_cmd_t iolinkremote_cmd = {
        .command = "io_linkremote",
        .help = "Link a remote to a IO-HomeControl device",
        .hint = NULL,
        .func = &do_iolinkremote_cmd,
        .argtable = &iolinkremote_args,
        .func_w_context = NULL,
        .context = NULL
    };

    ESP_ERROR_CHECK( esp_console_cmd_register(&iolinkremote_cmd) );
}

// ******************* IO Register commands ********************

void register_io_cmdline_tools(iohome::IoHomeControl *io_home)
{
    sIoHome = io_home;
    register_iodiscover();
    register_ioadd();
    register_ioopen();
    register_ioclose();
    register_iostop();
    register_iosetfavpos();
    register_iosetpos();
    register_ioupdate();
    register_iosetname();
    register_iolinkremote();
}