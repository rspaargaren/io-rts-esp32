import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { StoredLogLevel } from "../utils/logStorage";
import {
  appendStoredLogMessage,
  normalizeLogLevel,
} from "../utils/logStorage";

type WebSocketMessage = Record<string, unknown>;

export type WebSocketLogMessage = {
  type?: string;
  position?: number;
  id?: string;
  is_stopped?: boolean;
  estimated?: boolean;
  message?: string;
  level?: StoredLogLevel | boolean;
};

type UseWebSocketOptions<T> = {
  url?: string;
  autoConnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  helloMessage?: string;
  onMessage?: (data: T) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export function useWebSocket<T = WebSocketMessage>({
  autoConnect = true,
  reconnectDelayMs = 1000,
  maxReconnectDelayMs = 30000,
  helloMessage = '{"type":"hello"}',
  onMessage,
  onOpen,
  onClose,
}: UseWebSocketOptions<T>) {
  const productionUrl =
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}/ws`;
  const url = import.meta.env.VITE_WEBSOCKET_URL || productionUrl;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(reconnectDelayMs);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(autoConnect);
  const onMessageRef = useRef<typeof onMessage>(onMessage);
  const onOpenRef = useRef<typeof onOpen>(onOpen);
  const onCloseRef = useRef<typeof onClose>(onClose);
  const helloMessageRef = useRef(helloMessage);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<T | null>(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    helloMessageRef.current = helloMessage;
  }, [helloMessage]);

  const connect = useCallback(() => {
    if (!url) return;

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectDelayRef.current = reconnectDelayMs;
      setConnected(true);
      socket.send(helloMessageRef.current);
      onOpenRef.current?.();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;

        if (
          data &&
          typeof data === "object" &&
          (data as { type?: unknown }).type === "log"
        ) {
          const logMessage = data as {
            message?: unknown;
            level?: StoredLogLevel | boolean;
          };

          if (typeof logMessage.message === "string") {
            appendStoredLogMessage({
              id: Date.now() + Math.random(),
              message: logMessage.message,
              level: normalizeLogLevel(logMessage.level),
            });
          }
        }

        setLastMessage(data);
        onMessageRef.current?.(data);
      } catch (error) {
        console.warn("WebSocket message parse error:", error);
      }
    };

    socket.onclose = () => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }

      setConnected(false);
      onCloseRef.current?.();

      if (!shouldReconnectRef.current) {
        return;
      }

      const timeout = reconnectDelayRef.current;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, timeout);

      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        maxReconnectDelayMs,
      );
    };

    socket.onerror = () => {
      setConnected(false);
    };
  }, [
    url,
    reconnectDelayMs,
    maxReconnectDelayMs,
  ]);

  const send = useCallback((payload: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const value =
      typeof payload === "string" ? payload : JSON.stringify(payload);

    socket.send(value);
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = autoConnect;

    if (!autoConnect || !url) return;

    connect();

    return () => {
      shouldReconnectRef.current = false;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, url, connect]);

  return {
    connected,
    lastMessage,
    send,
    reconnect: connect,
    socket: wsRef.current,
  };
}
