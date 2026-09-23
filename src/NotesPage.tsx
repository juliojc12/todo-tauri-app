import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Note } from "./api";
import { NotesHeader } from "./components/NotesHeader";
import { NoteItem } from "./components/NoteItem";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PlusIcon } from "./components/Icons";

interface Props {
  onError: (message: string) => void;
}

/** `note` is null for the one draft not saved yet; `key` stays the same after it is saved. */
interface Entry {
  key: string;
  note: Note | null;
}

// Matches the note-out animation in App.css.
const LEAVE_MS = 220;

function preview(body: string) {
  const line = body.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/** Right page of the notebook: free-form notes, newest first. */
export function NotesPage({ onError }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const draftSeq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    api
      .listNotes()
      .then((notes) => setEntries(notes.map((note) => ({ key: `n${note.id}`, note }))))
      .catch((e) => onError(String(e)))
      .finally(() => setLoaded(true));
  }, [onError]);

  const onSaved = useCallback(
    (key: string, note: Note) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, note } : e))),
    [],
  );

  const remove = useCallback((key: string) => setEntries((es) => es.filter((e) => e.key !== key)), []);

  const addNote = () => {
    const draft = entries.find((e) => e.note === null);
    if (draft) {
      listRef.current?.querySelector<HTMLTextAreaElement>(`[data-key="${draft.key}"] textarea`)?.focus();
      return;
    }
    setEntries((es) => [{ key: `draft${++draftSeq.current}`, note: null }, ...es]);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const note = pendingDelete;
    setPendingDelete(null);
    try {
      await api.deleteNote(note.id);
    } catch (e) {
      onError(String(e));
      return;
    }
    const key = entries.find((e) => e.note?.id === note.id)?.key;
    if (!key) return;
    setLeaving(key);
    window.setTimeout(() => {
      remove(key);
      setLeaving(null);
    }, LEAVE_MS);
  };

  const count = entries.filter((e) => e.note).length;

  return (
    <>
      <NotesHeader count={count} />

      <button type="button" className="compose compose-button" onClick={addNote}>
        <span className="compose-icon" aria-hidden="true">
          <PlusIcon />
        </span>
        <span className="compose-label">Nova nota</span>
      </button>

      {loaded && entries.length === 0 && (
        <p className="empty">Nenhuma nota ainda. Comece uma pela linha acima.</p>
      )}

      <ul className="notes" ref={listRef} aria-label="Notas">
        {entries.map((e) => (
          <li key={e.key} data-key={e.key} className={e.key === leaving ? "note note-leaving" : "note"}>
            <NoteItem
              note={e.note}
              onSaved={(note) => onSaved(e.key, note)}
              onDiscardDraft={() => remove(e.key)}
              onDelete={setPendingDelete}
              onError={onError}
            />
          </li>
        ))}
      </ul>

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir esta nota?"
          message={`"${preview(pendingDelete.body)}" será apagada de vez. Não dá para desfazer.`}
          confirmLabel="Excluir nota"
          cancelLabel="Manter nota"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
