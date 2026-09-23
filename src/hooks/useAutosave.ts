import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved";

export interface Autosave {
  status: SaveStatus;
  /** Records an edit; it is saved `delay` ms after the last one. */
  change: (value: string) => void;
  /** Saves the pending edit right away (blur, Save button, Ctrl+S). */
  flush: () => void;
  /** Drops the pending edit without saving it. */
  discard: () => void;
}

/**
 * Debounced autosave for one text value. Saves never overlap: edits made while a save
 * is running are saved once it finishes. A failed save keeps the text pending (status
 * back to "dirty") so the Save button can retry. Pending edits are saved on unmount.
 */
export function useAutosave(
  save: (value: string) => Promise<void>,
  onError: (message: string) => void,
  delay = 1000,
): Autosave {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    saveRef.current = save;
    onErrorRef.current = onError;
  });

  const pending = useRef<string | null>(null);
  const running = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const run = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (running.current || pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    running.current = true;
    setStatus("saving");
    try {
      await saveRef.current(value);
      running.current = false;
      if (pending.current === null) setStatus("saved");
      else void run(); // edits arrived while saving
    } catch (e) {
      running.current = false;
      pending.current ??= value;
      setStatus("dirty");
      onErrorRef.current(String(e));
    }
  }, []);

  const change = useCallback(
    (value: string) => {
      pending.current = value;
      setStatus((s) => (s === "saving" ? s : "dirty"));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(), delay);
    },
    [run, delay],
  );

  const flush = useCallback(() => void run(), [run]);

  const discard = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = null;
    setStatus((s) => (s === "saving" ? s : "idle"));
  }, []);

  useEffect(() => () => void run(), [run]);

  return { status, change, flush, discard };
}
