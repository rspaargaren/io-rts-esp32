import useApi from "../useApi.tsx";
import { Device } from "../../models/Types.ts";

export function useDevices() {
  return useApi<Device[]>({
    endpoint: "/api/devices",
    method: "GET",
  });
}