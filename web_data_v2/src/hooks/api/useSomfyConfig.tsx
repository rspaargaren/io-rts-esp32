import useApi, { ApiResponse } from "../useApi";
import { SomfyConfig } from "../../models/Types";

export function useSomfyConfig(): ApiResponse<SomfyConfig> {
  return useApi<SomfyConfig>({
    endpoint: "/api/somfy/credentials",
    method: "GET",
  });
}