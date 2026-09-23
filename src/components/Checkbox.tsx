interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  small?: boolean;
}

/** Native checkbox (keeps keyboard/a11y behavior) with a hand-drawn check that strokes in. */
export function Checkbox({ checked, onChange, label, disabled, small }: Props) {
  return (
    <label className={`cbx${small ? " cbx-sm" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="cbx-box" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path className="cbx-mark" d="M5 12.8l4.3 4.2L19.2 6.6" />
        </svg>
      </span>
    </label>
  );
}
