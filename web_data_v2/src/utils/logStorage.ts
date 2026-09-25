export type StoredLogLevel = "debug" | "info" | "error";

export type StoredLogEntry = {
  id: number;
  message: string;
  level: StoredLogLevel;
};

const STORAGE_KEY = "io-rts-esp32:web-logs";
const MAX_LOG_MESSAGES = 100;

export function normalizeLogLevel(level?: StoredLogLevel | boolean): StoredLogLevel {
  if (level === true) return "error";
  if (level === false || level === undefined) return "debug";
  return level;
}

export function readStoredLogMessages(): StoredLogEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;

        const candidate = entry as Partial<StoredLogEntry>;
        if (
          typeof candidate.id !== "number" ||
          typeof candidate.message !== "string" ||
          (candidate.level !== "debug" &&
            candidate.level !== "info" &&
            candidate.level !== "error")
        ) {
          return null;
        }

        return {
          id: candidate.id,
          message: candidate.message,
          level: candidate.level,
        };
      })
      .filter((entry): entry is StoredLogEntry => entry !== null)
      .slice(-MAX_LOG_MESSAGES);
  } catch {
    return [];
  }
}

export function storeLogMessages(messages: StoredLogEntry[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_LOG_MESSAGES)),
    );
  } catch {
    // Ignore storage failures (private mode, quota exceeded, etc.).
  }
}

export function appendStoredLogMessage(message: StoredLogEntry): void {
  const next = [...readStoredLogMessages(), message].slice(-MAX_LOG_MESSAGES);
  storeLogMessages(next);
}

export function clearStoredLogMessages(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

