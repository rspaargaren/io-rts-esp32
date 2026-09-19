import useApi, { ApiResponse } from "../useApi";
import { MqttConfig } from "../../models/Types";

export function useMqttConfig(): ApiResponse<MqttConfig> {
  return useApi<MqttConfig>({
    endpoint: "/api/mqtt",
    method: "GET",
  });
}