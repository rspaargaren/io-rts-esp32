import { ComponentChildren } from "preact";

interface DeviceRowProps {
  label?: ComponentChildren;
  subLabel?: ComponentChildren;
  children: ComponentChildren;
  className?: string;
}

export function DeviceRow({
  label,
  subLabel,
  children,
  className = "dev-row",
}: DeviceRowProps) {
  return (
    <div class={className}>
      {(label || subLabel) && (
        <div>
          {label && <div class="dev-row-label">{label}</div>}
          {subLabel && <div class="dev-row-sub">{subLabel}</div>}
        </div>
      )}
      <div class="dev-row-right">{children}</div>
    </div>
  );
}

