import { useEffect, useState } from "preact/hooks";

interface CheckboxProps {
  name?: string;
  checked?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export function Checkbox({
  name,
  checked = false,
  ariaLabel,
  disabled = false,
  onChange,
}: CheckboxProps) {
  const [isChecked, setIsChecked] = useState(checked);

  useEffect(() => {
    setIsChecked(checked);
  }, [checked]);

  return (
    <label class="s-checkbox">
      <input
        type="checkbox"
        name={name}
        checked={isChecked}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => {
          const nextChecked = (event.currentTarget as HTMLInputElement).checked;
          setIsChecked(nextChecked);
          onChange?.(nextChecked);
        }}
      />
      <span class={`s-toggle${isChecked ? " on" : ""}`} aria-hidden="true" />
    </label>
  );
}
