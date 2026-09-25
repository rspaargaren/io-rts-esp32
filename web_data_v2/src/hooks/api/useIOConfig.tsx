import useApi, { ApiResponse } from "../useApi";
import { IoConfig } from "../../models/Types";

export function useIOConfig(): ApiResponse<IoConfig> {
  return useApi<IoConfig>({
    endpoint: "/api/io/config",
    method: "GET",
  });
}
