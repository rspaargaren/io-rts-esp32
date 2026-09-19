import { useEffect, useState } from "preact/hooks";
import { otaKeyResponse } from "../models/Types";

export interface ApiResponse<Type> {
  data: Type | undefined;
  loaded: boolean;
  isError: boolean;
}

export default function useApi<Type>({
  endpoint,
  method,
  body,
}: {
  endpoint: string;
  method: "GET" | "POST";
  body?: any;
}): ApiResponse<Type> {
  const [data, setData] = useState<Type | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function doFetch() {
      setLoaded(false);
      setIsError(false);

      const otaKey = await fetch("/api/ota/key", {});

      try {
        const res = await fetch(endpoint, {
          method,
          headers: {
            Accept: "application/json",
            "Content-Type": body ? "application/json" : "text/plain",
            "X-OTA-Key": otaKey.ok
              ? ((await otaKey.json()) as otaKeyResponse).key
              : "",
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
        let parsed: any = undefined;
        try {
          // 204 No Content will throw when parsing json, so guard
          if (res.status !== 204) {
            parsed = await res.json();
          }
        } catch (e) {
          parsed = undefined;
        }

        if (!cancelled) {
          setData(parsed as Type | undefined);
          setIsError(false);
          setLoaded(true);
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        if (!cancelled) {
          setIsError(true);
          setData(undefined);
          setLoaded(true);
        }
      }
    }

    doFetch();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint, method, JSON.stringify(body ?? null)]);

  return { data, loaded, isError };
}
