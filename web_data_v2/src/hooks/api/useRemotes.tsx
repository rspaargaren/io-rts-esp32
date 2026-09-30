import useApi from "../useApi.tsx";
import { Remote } from "../../models/Types.ts";

export function useRemotes() {
  return useApi<Remote[]>({
    endpoint: "/api/remotes",
    method: "GET",
  });
}