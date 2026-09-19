import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

type LogLevel = "debug" | "info" | "error";
type LogFilter = "all" | "info" | "off";

const webSocketHost = "192.168.0.78";

type LogEntry = {
  id: number;
  message: string;
  level: LogLevel;
};

const logLevelVisible = (entryLevel: LogLevel, filter: LogFilter): boolean => {
  if (filter === "off") return false;
  if (filter === "info") return entryLevel === "info" || entryLevel === "error";
  return true;
};

export function Log() {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [messages, setMessages] = useState<LogEntry[]>([]);
  const statusMessagesRef = useRef<HTMLDivElement | null>(null);

  const { connected } = useWebSocket({
    url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${webSocketHost}/ws`,
    helloMessage: '{"type":"hello"}',
    onOpen: () => {
      console.log("WS connected");
    },
    onClose: () => {
      console.log("WS closed");
    },
    onMessage: (data) => {
      if (data.type === "log") {
        logStatus(data.message, data.level);
      }

      if (data.type === "init") {
        console.log("initialize");
      }
    },
  });

  const logStatus = useCallback(
    (message: string, level?: LogLevel | boolean) => {
      const normalizedLevel: LogLevel =
        level === true ? "error" : !level || level === false ? "debug" : level;

      if (filter === "off") return;

      setMessages((prev) => {
        const next = [
          ...prev,
          { id: Date.now() + Math.random(), message, level: normalizedLevel },
        ];
        return next.slice(-100);
      });
    },
    [filter],
  );

  const visibleMessages = useMemo(
    () => messages.filter((entry) => logLevelVisible(entry.level, filter)),
    [messages, filter],
  );

  useEffect(() => {
    if (!statusMessagesRef.current) return;
    statusMessagesRef.current.scrollTop =
      statusMessagesRef.current.scrollHeight;
  }, [visibleMessages.length, filter]);

  return (
    <section className="view active">
      <div className="view-header">
        <h2 className="view-title" data-i18n="nav.help">
          Log
        </h2>
      </div>

      <div className="log-toolbar">
        <button
          type="button"
          className={`log-filter-btn ${filter === "all" ? "active" : ""}`}
          data-filter="all"
          onClick={() => setFilter("all")}
        >
          All
        </button>

        <button
          type="button"
          className={`log-filter-btn ${filter === "info" ? "active" : ""}`}
          data-filter="info"
          onClick={() => setFilter("info")}
        >
          Info
        </button>

        <button
          type="button"
          className={`log-filter-btn ${filter === "off" ? "active" : ""}`}
          data-filter="off"
          onClick={() => setFilter("off")}
        >
          Off
        </button>
      </div>

      <div
        id="status-messages"
        ref={statusMessagesRef}
        aria-live="polite"
        style={{ display: filter === "off" ? "none" : undefined }}
      >
        {visibleMessages.map(({ id, message, level }) => (
          <p key={id} data-level={level}>
            {message}
          </p>
        ))}
      </div>
    </section>
  );
}
