import { useCallback, useEffect, useState } from "preact/hooks";
import { useOtaKey } from "./api/useOtaKey.tsx";

export interface ApiResponse<Type> {
  data: Type | undefined;
  loaded: boolean;
  isError: boolean;
  refresh: () => void;
}

export default function useApi<Type>({
  endpoint,
  method,
  body,
  headers = {},
  includeOtaKey = true,
  refreshTime = 0,
}: {
  endpoint: string;
  method: "GET" | "POST";
  body?: unknown;
  headers?: HeadersInit;
  includeOtaKey?: boolean;
  refreshTime?: number;
}): ApiResponse<Type> {
  const [data, setData] = useState<Type | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const otaKeyApi = useOtaKey();

  const refresh = useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let inFlight = false;

    async function doFetch(background = false) {
      if (inFlight || controller.signal.aborted) return;

      inFlight = true;

      if (!background) {
        setLoaded(false);
      }
      setIsError(false);

      const otaKey = includeOtaKey ? otaKeyApi.data?.key : undefined;

      if (includeOtaKey && !otaKeyApi.loaded) {
        inFlight = false;
        return;
      }

      if (includeOtaKey && !otaKey) {
        if (!cancelled) {
          setIsError(true);
          setData(undefined);
          setLoaded(true);
        }
        inFlight = false;
        return;
      }

      try {
        const res = await fetch(endpoint, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": body ? "application/json" : "text/plain",
            ...headers,
            ...(otaKey
              ? {
                  "X-OTA-Key": otaKey,
                }
              : {}),
          },
          body:
            method === "POST" && body !== undefined
              ? JSON.stringify(body)
              : undefined,
          signal: controller.signal,
          credentials: "same-origin",
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          setIsError(true);
          setData(undefined);
          setLoaded(true);
          return;
        }

        // try parse JSON, fallback to undefined for empty body
        let parsed: Type | undefined = undefined;
        try {
          // 204 No Content will throw when parsing json, so guard
          if (res.status !== 204) {
            parsed = await res.json();
          }
        } catch  {
          parsed = undefined;
        }

        if (!cancelled) {
          setData(parsed);
          setIsError(false);
          setLoaded(true);
        }
      } catch (err: { name?: string } | unknown) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!cancelled) {
          setIsError(true);
          setData(undefined);
          setLoaded(true);
        }
      } finally {
        inFlight = false;
      }
    }

    doFetch();

    if (refreshTime > 0) {
      intervalId = setInterval(() => {
        void doFetch(true);
      }, refreshTime * 1000);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
      controller.abort();
    };
  }, [
    endpoint,
    method,
    JSON.stringify(body ?? null),
    JSON.stringify(headers),
    includeOtaKey,
    otaKeyApi.data?.key,
    otaKeyApi.loaded,
    refreshTime,
    refreshNonce,
  ]);

  return { data, loaded, isError, refresh };
}
