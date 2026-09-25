import useApi, { ApiResponse } from "../useApi";
import { FallBackConfig } from "../../models/Types";

export function useFallBackConfig(): ApiResponse<FallBackConfig> {
  return useApi<FallBackConfig>({
    endpoint: "/api/wifi/fallback",
    method: "GET",
  });
}
