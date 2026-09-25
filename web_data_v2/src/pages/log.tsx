import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket, WebSocketLogMessage } from "../hooks/useWebSocket";
import {
  clearStoredLogMessages,
  readStoredLogMessages,
  type StoredLogEntry,
} from "../utils/logStorage";

export type LogLevel = StoredLogEntry["level"];
export type LogFilter = "all" | "info" | "off";

export type LogEntry = StoredLogEntry;

const logLevelVisible = (entryLevel: LogLevel, filter: LogFilter): boolean => {
  if (filter === "off") return false;
  if (filter === "info") return entryLevel === "info" || entryLevel === "error";
  return true;
};

export function Log() {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [messages, setMessages] = useState<LogEntry[]>(() =>
    readStoredLogMessages(),
  );
  const statusMessagesRef = useRef<HTMLDivElement | null>(null);

  useWebSocket<WebSocketLogMessage>({
    helloMessage: '{"type":"hello"}',
    onOpen: () => {
      console.log("WS connected");
    },
    onClose: () => {
      console.log("WS closed");
    },
    onMessage: (data) => {
      if (data.type === "log") {
        logStatus(data.message || "", data.level);
      }

      if (data.type === "init") {
        console.log("initialize");
      }
    },
  });

  const logStatus = useCallback(
    (message: string, level?: LogLevel | boolean) => {
      const normalizedLevel: LogLevel =
        level === true ? "error" : level === false || level === undefined ? "debug" : level;

      setMessages((prev) => {
        const next = [
          ...prev,
          { id: Date.now() + Math.random(), message, level: normalizedLevel },
        ];
        return next.slice(-100);
      });
    },
    [],
  );

  const clearLogs = useCallback(() => {
    clearStoredLogMessages();
    setMessages([]);
  }, []);

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
          className="log-filter-btn"
          onClick={clearLogs}
          aria-label="Delete saved logs"
        >
          Delete logs
        </button>

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
