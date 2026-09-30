import useApi, { ApiResponse } from "../useApi";
import { WifiConfig } from "../../models/Types";

export function useWifiConfig(): ApiResponse<WifiConfig> {
  return useApi<WifiConfig>({
    endpoint: "/api/wifi/config",
    method: "GET",
  });
}