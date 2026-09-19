import { useCallback, useEffect, useRef, useState } from "react";

type WebSocketMessage = Record<string, any>;

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
  url,
  autoConnect = true,
  reconnectDelayMs = 1000,
  maxReconnectDelayMs = 30000,
  helloMessage = '{"type":"hello"}',
  onMessage,
  onOpen,
  onClose,
}: UseWebSocketOptions<T>) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(reconnectDelayMs);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<T | null>(null);

  const connect = useCallback(() => {
    if (!url) return;

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectDelayRef.current = reconnectDelayMs;
      setConnected(true);
      socket.send(helloMessage);
      onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;
        setLastMessage(data);
        onMessage?.(data);
      } catch (error) {
        console.warn("WebSocket message parse error:", error);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      onClose?.();

      const timeout = reconnectDelayRef.current;
      setTimeout(() => {
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
    helloMessage,
    onMessage,
    onOpen,
    onClose,
  ]);

  const send = useCallback((payload: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const value =
      typeof payload === "string" ? payload : JSON.stringify(payload);

    socket.send(value);
  }, []);

  useEffect(() => {
    if (!autoConnect || !url) return;

    connect();

    return () => {
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
