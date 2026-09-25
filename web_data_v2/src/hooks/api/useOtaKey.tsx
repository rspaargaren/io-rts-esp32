import { useEffect, useState } from "preact/hooks";
import type { ApiResponse } from "../useApi";
import { Key } from "../../models/Types";

export function useOtaKey(): ApiResponse<Key> {
  const [data, setData] = useState<Key | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = () => {
    setRefreshNonce((prev) => prev + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadOtaKey() {
      setLoaded(false);
      setIsError(false);

      try {
        const response = await fetch("/api/ota/key", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
          credentials: "same-origin",
        });

        if (controller.signal.aborted) return;

        if (!response.ok) {
          if (!cancelled) {
            setIsError(true);
            setData(undefined);
            setLoaded(true);
          }
          return;
        }

        const parsed = (await response.json()) as Key;

        if (!cancelled) {
          setData(parsed);
          setIsError(false);
          setLoaded(true);
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;

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
      controller.abort();
    };
  }, [refreshNonce]);

  return { data, loaded, isError, refresh };
}
