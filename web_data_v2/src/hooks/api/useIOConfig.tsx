import useApi from "../useApi";
import { IoConfig } from "../../models/Types";

export function useIOConfig() {
  return useApi<IoConfig>({
    endpoint: "api/io/config",
    method: "GET",
  });
}
