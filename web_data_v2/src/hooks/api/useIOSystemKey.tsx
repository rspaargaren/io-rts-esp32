import useApi, { ApiResponse } from "../useApi";
import { Key } from "../../models/Types";

export default function useIOSystemKey(): ApiResponse<Key> {
  return useApi<Key>({
    endpoint: "/api/io/key",
    method: "GET",
  });
}
