import { useCallback, useEffect, useState } from "preact/hooks";
import type { ApiResponse } from "../useApi";
import { Key } from "../../models/Types";

let cachedKey: Key | undefined;
let keyRequest: Promise<Key> | undefined;

function requestOtaKey(forceRefresh: boolean): Promise<Key> {
  if (!forceRefresh && cachedKey) return Promise.resolve(cachedKey);
  if (!forceRefresh && keyRequest) return keyRequest;

  const request = fetch("/api/ota/key", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load OTA key (${response.status})`);
    }
    const parsed = (await response.json()) as Key;
    cachedKey = parsed;
    return parsed;
  });

  keyRequest = request;
  void request.then(
    () => {
      if (keyRequest === request) keyRequest = undefined;
    },
    () => {
      if (keyRequest === request) keyRequest = undefined;
    },
  );
  return request;
}

export function useOtaKey(): ApiResponse<Key> {
  const [data, setData] = useState<Key | undefined>(() => cachedKey);
  const [loaded, setLoaded] = useState(() => cachedKey !== undefined);
  const [isError, setIsError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOtaKey() {
      if (refreshNonce > 0) setLoaded(false);
      setIsError(false);
      try {
        const parsed = await requestOtaKey(refreshNonce > 0);
        if (!cancelled) {
          setData(parsed);
          setIsError(false);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setIsError(true);
          setData(undefined);
          setLoaded(true);
        }
      }
    }

    void loadOtaKey();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return { data, loaded, isError, refresh };
}
