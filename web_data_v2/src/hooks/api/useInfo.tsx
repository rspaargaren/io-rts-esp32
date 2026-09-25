import useApi, { ApiResponse } from "../useApi";
import { InfoResponse } from "../../models/Types";

export function useInfo(refreshTime: number = 0): ApiResponse<InfoResponse> {
  return useApi<InfoResponse>({
    endpoint: "/api/info",
    method: "GET",
    refreshTime,
  });
}
