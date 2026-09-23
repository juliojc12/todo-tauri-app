import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, NOTE_MAX_CHARS, type Note } from "../api";
import { useAutosave, type SaveStatus } from "../hooks/useAutosave";
import { TrashIcon } from "./Icons";

interface Props {
  /** null while this is a new draft that has not reached the database yet. */
  note: Note | null;
  onSaved: (note: Note) => void;
  onDiscardDraft: () => void;
  onDelete: (note: Note) => void;
  onError: (message: string) => void;
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  dirty: "",
  saving: "Salvando…",
  saved: "Salvo",
};

/** "2026-09-23 14:32:05.123" (UTC, from SQLite) → "23 set, 14:32" in local time. */
function formatStamp(utc: string) {
  const d = new Date(utc.replace(" ", "T") + "Z");
  const month = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${d.getDate()} ${month}, ${time}`;
}

export function NoteItem({ note, onSaved, onDiscardDraft, onDelete, onError }: Props) {
  const [text, setText] = useState(note?.body ?? "");
  // Refs, not props: a save must see the id created by the save right before it.
  const idRef = useRef<number | null>(note?.id ?? null);
  const savedBody = useRef(note?.body ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  const save = useCallback(
    async (body: string) => {
      const saved =
        idRef.current === null ? await api.createNote(body) : await api.updateNote(idRef.current, body);
      idRef.current = saved.id;
      savedBody.current = saved.body;
      onSaved(saved);
    },
    [onSaved],
  );
  const autosave = useAutosave(save, onError);

  // A new draft opens with the cursor in it.
  useEffect(() => {
    if (idRef.current === null) ref.current?.focus();
  }, []);

  // Grow with the content (no inner scroll); re-measure when the window width changes the wrapping.
  useLayoutEffect(() => {
    const grow = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [text]);

  const change = (value: string) => {
    setText(value);
    // Blank text is never saved: a note goes away only through the trash button.
    if (value.trim()) autosave.change(value);
    else autosave.discard();
  };

  const leave = () => {
    if (text.trim()) autosave.flush();
    else if (idRef.current === null) onDiscardDraft();
    else setText(savedBody.current);
  };

  return (
    <>
      <div className="note-meta">
        <span>{note ? formatStamp(note.created_at) : "Nova nota"}</span>
        <span className="note-status" aria-live="polite">
          {STATUS_LABEL[autosave.status]}
        </span>
        <div className="note-actions">
          {autosave.status === "dirty" && (
            <button
              type="button"
              className="note-save"
              // Keep the focus in the text so the button does not vanish on blur before the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={autosave.flush}
            >
              Salvar
            </button>
          )}
          {note && (
            <button
              type="button"
              className="act act-danger"
              aria-label="Excluir nota"
              onClick={() => {
                autosave.discard();
                onDelete(note);
              }}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      <textarea
        ref={ref}
        className="note-text"
        value={text}
        rows={2}
        maxLength={NOTE_MAX_CHARS}
        placeholder="Escreva sua nota. Enter pula linha."
        aria-label={note ? "Nota" : "Nova nota"}
        onChange={(e) => change(e.target.value)}
        onBlur={leave}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            autosave.flush();
          }
        }}
      />
    </>
  );
}
