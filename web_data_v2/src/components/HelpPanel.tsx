import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import useI18n from "../hooks/useI18n";

type TranslateFn = (key: string, params?: Record<string, any>) => string;

type HelpSection = {
  label: string;
  body: string;
  warn?: boolean;
};

type HelpData = {
  title: string;
  sections: HelpSection[];
};

type HelpPanelProps = {
  helpKey: string | undefined;
  isOpen?: boolean;
  onClose?: () => void;
  t?: TranslateFn;
  helpLabel?: string;
};

const SECTION_KEYS: Record<string, Array<{ key: string; warn?: boolean }>> = {
  wifi: [{ key: "what-it-does" }, { key: "after-saving" }, { key: "scan" }],
  "fallback-ap": [
    { key: "what-it-does" },
    { key: "hotspot-name" },
    { key: "password", warn: true },
    { key: "retries-boot" },
    { key: "retries-running" },
    { key: "timeout" },
  ],
  network: [
    { key: "dhcp" },
    { key: "static-ip" },
    { key: "hostname" },
    { key: "sntp-server" },
  ],
  mqtt: [
    { key: "what-it-does" },
    { key: "discovery" },
    { key: "tls" },
    { key: "topics" },
  ],
  syslog: [
    { key: "what-it-does" },
    { key: "compatible-servers" },
    { key: "min-level" },
  ],
  somfy: [
    { key: "what-it-does" },
    { key: "what-is-imported" },
    { key: "prerequisite" },
    { key: "credentials" },
  ],
  controller: [
    { key: "node-address" },
    { key: "tx-power" },
    { key: "passive-mode" },
  ],
  "io-key": [
    { key: "what-it-is" },
    { key: "changing-key" },
    { key: "learn" },
    { key: "send-key" },
    { key: "pair" },
    { key: "sniff" },
  ],
  "ota-key": [{ key: "what-it-is" }, { key: "usage" }, { key: "rotation" }],
  backup: [{ key: "backup" }, { key: "restore" }],
};

function translated(t: TranslateFn, key: string): string | null {
  const value = t(key);
  return value === key ? null : value;
}

export function getHelpData(key: string, t: TranslateFn): HelpData | null {
  const title =
    translated(t, `help.${key}.title`) ??
    translated(t, `popup.help_${key.replace(/-/g, "_")}`) ??
    translated(t, "popup.help_title") ??
    key;

  const plainBody = translated(t, `help.${key}`);
  if (plainBody) {
    return {
      title,
      sections: [{ label: title, body: plainBody }],
    };
  }

  const sections: HelpSection[] = [];
  for (const { key: sectionKey, warn } of SECTION_KEYS[key] ?? []) {
    const label = translated(t, `help.${key}.${sectionKey}.label`);
    const body = translated(t, `help.${key}.${sectionKey}.body`);

    if (label && body) {
      sections.push({ label, body, warn });
    }
  }

  return sections.length ? { title, sections } : null;
}

function renderBody(body: string) {
  return body.split("\n").map((line, index) => (
    <span key={`${index}-${line}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

export default function HelpPanel({
  helpKey,
  isOpen,
  onClose,
  t,
  helpLabel,
}: HelpPanelProps) {
  const i18n = useI18n();
  const translate = t ?? i18n.t;
  const [localOpen, setLocalOpen] = useState(false);

  const data = useMemo(
    () => (helpKey ? getHelpData(helpKey, translate) : null),
    [helpKey, translate],
  );
  const controlled = typeof isOpen === "boolean";
  const panelOpen = controlled ? isOpen : localOpen;
  const buttonLabel =
    helpLabel ??
    data?.title ??
    (helpKey ? translated(translate, `help.${helpKey}.title`) : null) ??
    helpKey ??
    "Help";

  const closePanel = useCallback(() => {
    if (controlled) {
      onClose?.();
    } else {
      setLocalOpen(false);
    }
  }, [controlled, onClose]);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, closePanel]);

  if (!helpKey) {
    return null;
  }

  return (
    <>
      {!controlled ? (
        <button
          type="button"
          class="help-btn"
          aria-label={buttonLabel}
          title={buttonLabel}
          aria-expanded={panelOpen}
          onClick={(event) => {
            event.stopPropagation();
            setLocalOpen(true);
          }}
        >
          ?
        </button>
      ) : null}

      {panelOpen && data ? (
        <div
          id="help-panel"
          class="help-panel open"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`help-panel-title-${helpKey}`}
          onClick={closePanel}
        >
          <div
            class="help-panel-inner"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="help-sheet-handle" />

            <div class="help-panel-header">
              <span class="help-panel-title" id={`help-panel-title-${helpKey}`}>
                {data.title}
              </span>

              <button
                type="button"
                class="help-panel-close"
                aria-label="Close"
                onClick={closePanel}
              >
                ×
              </button>
            </div>

            <div class="help-panel-body">
              {data.sections.map((section, index) => (
                <div
                  class={
                    section.warn ? "help-block help-block-warn" : "help-block"
                  }
                  key={`${helpKey}-${index}`}
                >
                  <div class="help-block-label">{section.label}</div>
                  <div class="help-block-text">{renderBody(section.body)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
