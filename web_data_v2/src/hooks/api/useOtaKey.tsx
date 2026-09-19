import useApi, { ApiResponse } from "../useApi";
import { otaKeyResponse } from "../../models/Types";

export function useOtaKey(): ApiResponse<otaKeyResponse> {
  return useApi<otaKeyResponse>({
    endpoint: "/api/ota/key",
    method: "GET",
  });
}
