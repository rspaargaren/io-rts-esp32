import { useEffect, useRef, useState } from "preact/hooks";
import { AccordionHead } from "../AccordionHead";
import useIOSystemKey from "../../hooks/api/useIOSystemKey";
import { useOtaKey } from "../../hooks/api/useOtaKey";
import useI18n from "../../hooks/useI18n";
import { ActionResult } from "../../models/Types";

const IO_KEY_RE = /^[0-9A-F]{32}$/;
const SNIFF_DURATION_SECONDS = 120;

interface StatusState {
  text: string;
  tone: "" | "red" | "green";
}

interface IoSniffResponse {
  active?: boolean;
  key?: string | null;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "message" in data) {
    return String((data as { message?: unknown }).message ?? fallback);
  }

  return fallback;
}

async function requestIoJson<T>(url: string, otaKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-OTA-Key": otaKey,
    },
    credentials: "same-origin",
  });

  const data = await parseJson<T>(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        response.statusText || `Request failed with status ${response.status}`,
      ),
    );
  }

  return data;
}

async function postIoJson<T>(
  url: string,
  otaKey: string,
  payload: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-OTA-Key": otaKey,
    },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  });

  const data = await parseJson<T>(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        response.statusText || `Request failed with status ${response.status}`,
      ),
    );
  }

  return data;
}

export function IoSystemKeySettings() {
  const { t } = useI18n();
  const api = useIOSystemKey();
  const otaKeyApi = useOtaKey();

  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<StatusState>({
    text: "",
    tone: "",
  });

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editStatus, setEditStatus] = useState<StatusState>({
    text: "",
    tone: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const [isSniffOpen, setIsSniffOpen] = useState(false);
  const [sniffStatus, setSniffStatus] = useState<StatusState>({
    text: "",
    tone: "",
  });
  const [sniffActive, setSniffActive] = useState(false);
  const [sniffSecondsLeft, setSniffSecondsLeft] = useState(
    SNIFF_DURATION_SECONDS,
  );
  const [sniffCapturedKey, setSniffCapturedKey] = useState("");
  const [showSniffRetry, setShowSniffRetry] = useState(false);

  const editInputRef = useRef<HTMLInputElement | null>(null);
  const sniffPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sniffCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const otaKey = otaKeyApi.data?.key ?? "";
  const displayedKey = (currentKey ?? api.data?.key ?? "").toUpperCase();

  useEffect(() => {
    if (currentKey === null && api.data?.key !== undefined) {
      setCurrentKey(api.data.key.toUpperCase());
    }
  }, [api.data?.key, currentKey]);

  useEffect(() => {
    if (!isEditOpen) return;

    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [isEditOpen]);

  useEffect(() => {
    return () => {
      if (sniffPollTimerRef.current) {
        clearInterval(sniffPollTimerRef.current);
      }
      if (sniffCountdownTimerRef.current) {
        clearInterval(sniffCountdownTimerRef.current);
      }

      fetch("/api/io/sniff", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-OTA-Key": otaKey,
        },
        body: JSON.stringify({ active: false }),
        credentials: "same-origin",
      }).catch(() => undefined);
    };
  }, [otaKey]);

  function stopSniffPoll() {
    if (sniffPollTimerRef.current) {
      clearInterval(sniffPollTimerRef.current);
      sniffPollTimerRef.current = null;
    }

    if (sniffCountdownTimerRef.current) {
      clearInterval(sniffCountdownTimerRef.current);
      sniffCountdownTimerRef.current = null;
    }
  }

  async function stopSniffOnBackend() {
    try {
      await postIoJson<ActionResult>("/api/io/sniff", otaKey, {
        active: false,
      });
    } catch {
      // ignore stop failures
    }
  }

  async function cancelSniff() {
    stopSniffPoll();
    setSniffActive(false);
    await stopSniffOnBackend();
  }

  function openIoKeyEditModal(prefill?: string) {
    setEditValue((prefill || displayedKey).toUpperCase());
    setEditStatus({ text: "", tone: "" });
    setIsEditOpen(true);
  }

  function closeIoKeyEditModal() {
    setIsEditOpen(false);
    setIsSaving(false);
    setEditStatus({ text: "", tone: "" });
  }

  async function saveIoKey() {
    const key = editValue.trim().toUpperCase();

    if (!IO_KEY_RE.test(key)) {
      setEditStatus({ text: t("status.key-must-be-32-hex"), tone: "red" });
      return;
    }

    setIsSaving(true);
    setEditStatus({ text: "", tone: "" });

    try {
      const result = await postIoJson<ActionResult>("/api/io/key", otaKey, {
        key,
      });

      if (result.success === false) {
        setEditStatus({
          text: result.message || t("toast.save-failed"),
          tone: "red",
        });
        return;
      }

      setCurrentKey(key);
      setFieldStatus({ text: t("toast.key-saved-reboot"), tone: "green" });
      closeIoKeyEditModal();
      setShowKey(false);
    } catch (error) {
      setEditStatus({
        text: t("toast.error-saving-key", {
          message: error instanceof Error ? error.message : String(error),
        }),
        tone: "red",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function openSniffModal() {
    setSniffStatus({ text: "", tone: "" });
    setSniffActive(false);
    setSniffSecondsLeft(SNIFF_DURATION_SECONDS);
    setSniffCapturedKey("");
    setShowSniffRetry(false);
    setIsSniffOpen(true);
  }

  async function closeSniffModal() {
    setIsSniffOpen(false);
    setSniffCapturedKey("");
    setShowSniffRetry(false);
    setSniffStatus({ text: "", tone: "" });
    await cancelSniff();
  }

  async function startSniff() {
    stopSniffPoll();
    await stopSniffOnBackend();

    setSniffActive(false);
    setShowSniffRetry(false);
    setSniffCapturedKey("");
    setSniffStatus({ text: "", tone: "" });
    setSniffSecondsLeft(SNIFF_DURATION_SECONDS);

    try {
      const result = await postIoJson<ActionResult>("/api/io/sniff", otaKey, {
        active: true,
      });

      if (result.success === false) {
        setSniffStatus({
          text: result.message || t("toast.save-failed"),
          tone: "red",
        });
        setShowSniffRetry(true);
        return;
      }
    } catch (error) {
      setSniffStatus({
        text: t("status.failed-to-start", {
          message: error instanceof Error ? error.message : String(error),
        }),
        tone: "red",
      });
      setShowSniffRetry(true);
      return;
    }

    setSniffActive(true);

    sniffCountdownTimerRef.current = setInterval(() => {
      setSniffSecondsLeft((previous) => {
        if (previous <= 1) {
          stopSniffPoll();
          setSniffActive(false);
          setSniffStatus({ text: t("status.no-key-captured"), tone: "red" });
          setShowSniffRetry(true);
          void stopSniffOnBackend();
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    sniffPollTimerRef.current = setInterval(() => {
      requestIoJson<IoSniffResponse>("/api/io/sniff", otaKey)
        .then((result) => {
          if (!result?.key) return;

          stopSniffPoll();
          setSniffActive(false);
          setSniffCapturedKey(result.key.toUpperCase());
          setSniffStatus({ text: t("status.key-received"), tone: "green" });
          void stopSniffOnBackend();
        })
        .catch(() => undefined);
    }, 2000);
  }

  async function useSniffedKey() {
    if (!sniffCapturedKey) return;

    await closeSniffModal();
    openIoKeyEditModal(sniffCapturedKey);
  }

  return (
    <>
      <div class="acc-row" data-help="io-key">
        <AccordionHead
          title="IO System Key"
          titleI18n="settings.row.io-key"
          helpKey={"io-key"}
          helpLabel="Help for io-key"
          summary={
            <span class="acc-sum-val">
              {displayedKey ? "••••" : `(${t("label.not-set")})`}
            </span>
          }
        >
          <div class="sensitive-notice" data-i18n="label.io-key-warning">
            Changing this key makes all paired devices unreachable until reboot.
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input
              type={showKey ? "text" : "password"}
              class="s-input key-display"
              placeholder={`(${t("label.not-set")})`}
              value={api.data?.key}
              readOnly
              style="flex:1;min-width:140px;"
            />
            <button
              type="button"
              class="s-btn"
              onClick={() => setShowKey((previous) => !previous)}
              data-i18n={showKey ? "button.hide" : "button.show"}
            >
              {showKey ? t("button.hide") : t("button.show")}
            </button>
            <button
              type="button"
              class="s-btn"
              data-i18n="button.edit"
              onClick={() => openIoKeyEditModal()}
            >
              {t("button.edit")}
            </button>
            <button
              type="button"
              class="s-btn"
              data-i18n="button.sniff"
              onClick={openSniffModal}
            >
              {t("button.sniff")}
            </button>
            <button type="button" class="s-btn" data-i18n="button.learn">
              {t("button.learn")}
            </button>
          </div>
          <span
            class={`field-status ${fieldStatus.tone === "red" ? "error-text" : fieldStatus.tone === "green" ? "success-text" : ""}`}
          >
            {fieldStatus.text}
          </span>
        </AccordionHead>
      </div>

      {isEditOpen && (
        <div
          id="io-key-edit-modal"
          class="key-modal open"
          onClick={() => closeIoKeyEditModal()}
        >
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="key-modal-inner">
              <h3>{t("popup.io-key-edit-title")}</h3>
              <p class="key-modal-warning-text">
                {t("popup.io-key-edit-body")}
              </p>
              <label class="key-modal-label" for="io-key-new-input">
                {t("popup.io-key-new-label")}
              </label>
              <input
                id="io-key-new-input"
                ref={editInputRef}
                type="text"
                class="key-modal-input"
                maxlength={32}
                value={editValue}
                onInput={(e) =>
                  setEditValue(
                    (e.currentTarget as HTMLInputElement).value.toUpperCase(),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveIoKey();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeIoKeyEditModal();
                  }
                }}
                placeholder="00112233445566778899AABBCCDDEEFF"
                autocomplete="off"
                spellcheck={false}
              />
              <div
                class={`key-modal-status ${editStatus.tone === "red" ? "error-text" : editStatus.tone === "green" ? "success-text" : ""}`}
              >
                {editStatus.text}
              </div>
              <div class="key-modal-actions">
                <button
                  type="button"
                  class="btn-ghost"
                  data-i18n="button.cancel"
                  onClick={() => closeIoKeyEditModal()}
                >
                  {t("button.cancel")}
                </button>
                <button
                  type="button"
                  class="btn-danger-confirm"
                  data-i18n="button.save"
                  disabled={isSaving}
                  onClick={() => void saveIoKey()}
                >
                  {t("button.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isSniffOpen && (
        <div
          id="io-key-sniff-modal"
          class="key-modal open"
          onClick={() => {
            void closeSniffModal();
          }}
        >
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="key-modal-inner">
              <h3>{t("popup.io-key-sniff-title")}</h3>

              {!sniffActive && !sniffCapturedKey && (
                <p class="key-modal-warning-text">
                  {t("popup.io-key-sniff-body")}
                </p>
              )}

              {sniffActive && (
                <div>
                  <p class="key-modal-warning-text">
                    {t("popup.io-key-sniff-countdown")}
                  </p>
                  <p class="key-modal-warning-label">{sniffSecondsLeft}s</p>
                </div>
              )}

              {sniffCapturedKey && (
                <div>
                  <label class="key-modal-label">
                    {t("popup.io-key-sniff-captured-label")}
                  </label>
                  <div class="key-modal-input" style="margin-top:6px;">
                    {sniffCapturedKey}
                  </div>
                </div>
              )}

              <div
                class={`key-modal-status ${sniffStatus.tone === "red" ? "error-text" : sniffStatus.tone === "green" ? "success-text" : ""}`}
              >
                {sniffStatus.text}
              </div>

              <div class="key-modal-actions">
                <button
                  type="button"
                  class="btn-ghost"
                  data-i18n="button.cancel"
                  onClick={() => {
                    void closeSniffModal();
                  }}
                >
                  {t("button.cancel")}
                </button>

                {!sniffActive && !sniffCapturedKey && !showSniffRetry && (
                  <button
                    type="button"
                    class="btn-danger-confirm"
                    data-i18n="button.start-sniff"
                    onClick={() => {
                      void startSniff();
                    }}
                  >
                    {t("button.start-sniff")}
                  </button>
                )}

                {showSniffRetry && !sniffCapturedKey && (
                  <button
                    type="button"
                    class="btn-danger-confirm"
                    data-i18n="button.retry"
                    onClick={() => {
                      void startSniff();
                    }}
                  >
                    {t("button.retry")}
                  </button>
                )}

                {!!sniffCapturedKey && (
                  <button
                    type="button"
                    class="btn-danger-confirm"
                    data-i18n="button.use-key"
                    onClick={() => {
                      void useSniffedKey();
                    }}
                  >
                    {t("button.use-key")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
