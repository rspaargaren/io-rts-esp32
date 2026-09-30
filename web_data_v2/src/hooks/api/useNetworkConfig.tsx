import useApi, { ApiResponse } from "../useApi";
import { NetworkConfig } from "../../models/Types";

export function useNetworkConfig(): ApiResponse<NetworkConfig> {
  return useApi<NetworkConfig>({
    endpoint: "/api/network/config",
    method: "GET",
  });
}
