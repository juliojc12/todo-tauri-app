import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

/** Text input that saves on Enter/blur and cancels on Escape. */
export function InlineEdit({ value, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className="inline-edit"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
