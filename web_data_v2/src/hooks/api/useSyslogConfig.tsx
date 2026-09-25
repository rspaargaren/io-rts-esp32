import useApi, { ApiResponse } from "../useApi";
import { SyslogConfig } from "../../models/Types";

export function useSyslogConfig(): ApiResponse<SyslogConfig> {
  return useApi<SyslogConfig>({
    endpoint: "/api/syslog",
    method: "GET",
  });
}