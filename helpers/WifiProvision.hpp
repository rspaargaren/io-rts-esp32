#pragma once

#ifdef CONFIG_CONNECTIVITY_CHOICE_WIFI

namespace Helpers
{
    class WifiProvision
    {
    public:
        static void StartAP();
        static void StartProvisionServer();
        static void StartDnsServer();
    };
}

#endif // CONFIG_CONNECTIVITY_CHOICE_WIFI
