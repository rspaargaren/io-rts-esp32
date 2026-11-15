import { InfoResponse } from "../../models/Types";
import { AccordionHead } from "../AccordionHead";
import useI18n from "../../hooks/useI18n";

// Restart diagnostics: why the board last (re)started, how long it has been running and,
// when the previous run ended without a power cut, how long that run lasted and how low the
// free memory went. Unexpected restarts (crash / watchdog) are highlighted.

const UNEXPECTED = new Set([
  "crash",
  "low_memory",
  "interrupt_watchdog",
  "task_watchdog",
  "watchdog",
  "brownout",
]);

const REASON_DEFAULTS: Record<string, string> = {
  power_on: "Power on",
  reset_or_power_on: "Reset button or power on",
  low_memory: "Restarted itself: out of memory",
  external: "Reset button",
  software: "Restart (update, reboot or settings)",
  crash: "Crash",
  interrupt_watchdog: "Hung (interrupt watchdog)",
  task_watchdog: "Hung (task watchdog)",
  watchdog: "Hung (watchdog)",
  brownout: "Power dip (brownout)",
  deep_sleep: "Wake from deep sleep",
  unknown: "Unknown",
};

function duration(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export function RestartSettings({ data }: { data: InfoResponse | undefined }) {
  const { t } = useI18n();
  const tr = (key: string, def: string) => {
    const v = t(key);
    return v && v !== key ? v : def;
  };

  if (!data || data.reset_reason === undefined) return null;

  const reasonCode = data.reset_reason;
  const reason = tr(
    `label.reset-reason.${reasonCode}`,
    REASON_DEFAULTS[reasonCode] ?? reasonCode,
  );
  const unexpected = UNEXPECTED.has(reasonCode);

  const row = (label: string, value: string) => (
    <div class="settings-row" style="padding:4px 0;">
      <span class="row-label">{label}</span>
      <span class="row-value">{value}</span>
    </div>
  );

  return (
    <div class="acc-row">
      <AccordionHead
        title="Uptime"
        titleI18n="settings.row.uptime"
        summary={
          <span class="acc-sum-val">
            {duration(data.uptime_s ?? 0)}
            {unexpected ? ` — ⚠ ${reason}` : ""}
          </span>
        }
      >
        {row(tr("label.uptime", "Running for"), duration(data.uptime_s ?? 0))}
        {row(tr("label.reset-reason", "Last start"), reason)}
        {row(
          tr("label.boot-count", "Number of starts"),
          `${data.boot_count ?? "?"}`,
        )}
        {data.prev_uptime_s !== undefined
          ? row(
              tr("label.prev-uptime", "Previous run lasted"),
              duration(data.prev_uptime_s),
            )
          : null}
        {data.prev_heap_min !== undefined
          ? row(
              tr("label.prev-heap-min", "Lowest free memory in previous run"),
              kb(data.prev_heap_min),
            )
          : null}
        {data.prev_alloc_fail
          ? row(
              tr("label.prev-alloc-fail", "Out of memory in previous run"),
              `${data.prev_alloc_fail}× — ${data.prev_alloc_fail_size ?? "?"} B, ${data.prev_alloc_fail_task ?? "?"}, ${duration(data.prev_alloc_fail_at_s ?? 0)}`,
            )
          : null}
        {data.heap_free !== undefined && data.heap_min !== undefined
          ? row(
              tr("label.heap-now", "Free memory now (lowest)"),
              `${kb(data.heap_free)} (${kb(data.heap_min)})`,
            )
          : null}
        {data.heap_largest !== undefined
          ? row(
              tr("label.heap-largest", "Largest free block"),
              kb(data.heap_largest),
            )
          : null}
        {data.alloc_fail
          ? row(
              tr("label.alloc-fail", "Out of memory since start"),
              `${data.alloc_fail}×`,
            )
          : null}
        {data.prev_uptime_s === undefined ? (
          <p class="auth-state">
            {tr(
              "label.prev-run-unknown",
              "No data about the previous run: the board was powered off, or this is the first start with this firmware.",
            )}
          </p>
        ) : null}
      </AccordionHead>
    </div>
  );
}
