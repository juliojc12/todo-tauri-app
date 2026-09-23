# Notas + caderno aberto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma página de notas editáveis (criar/excluir, Enter pula linha, autosave + botão Salvar) e reorganizar o app como um caderno aberto: tarefas à esquerda, notas à direita.

**Architecture:** Nova tabela `notes` e quatro comandos Tauri em Rust, no mesmo padrão de `db.rs`/`lib.rs`. No frontend, `App.tsx` vira só a moldura do caderno; a lógica de tarefas vai sem mudanças para `TodoPage.tsx`; as notas ficam em `NotesPage.tsx` + `NoteItem.tsx`, com o salvamento isolado no hook `useAutosave`.

**Tech Stack:** Tauri v2, Rust + rusqlite, React 19 + TypeScript, Vite, CSS puro.

**Spec:** `docs/superpowers/specs/2026-09-23-notes-notebook-design.md`

## Global Constraints

- Comandos `cargo` rodam no **PowerShell** (no Git Bash o `link` errado quebra a compilação).
- Sem dependências novas (nem npm, nem crates).
- Textos da interface em português do Brasil; comentários de código em inglês, no estilo existente.
- Limite de nota: **10.000 caracteres** (`NOTE_MAX_CHARS`).
- Autosave **~1 s** após parar de digitar; também ao sair da nota (blur), no botão **Salvar** e em **Ctrl+S**.
- Enter no texto da nota **insere quebra de linha**, nunca salva.
- Janela: `width` 1280, `height` 820, `minWidth` 900, `minHeight` 560. Páginas sempre lado a lado.
- Tema escuro fixo "caderno à noite"; animações novas respeitam `prefers-reduced-motion` (já coberto pela regra global em `App.css`).
- Nenhuma permissão nova em `capabilities/default.json`.
- Toda verificação no app real usa um banco descartável via `TODO_APP_DB`, nunca o banco real do usuário.

## Review Focus

1. **Apagar todo o texto de uma nota existente e sair dela** → nada é enviado ao banco e o texto volta ao último conteúdo salvo (teste: Task 3, Step 8).
2. **Continuar digitando enquanto um salvamento está em andamento** → os salvamentos não se sobrepõem e o texto final fica no banco (teste: Task 3, Step 9).
3. **Nota nova: digitar e sair logo em seguida** (timer do autosave e blur quase juntos) → exatamente uma nota criada, sem duplicata (teste: Task 3, Step 7).
4. **Acentos e caracteres multibyte perto do limite** → 10.000 caracteres "é" são aceitos (limite em caracteres, não bytes) e 10.001 são recusados (teste: Task 1, Step 1).
5. **Excluir uma nota logo depois de editar** → a nota some sem aviso de erro "Registro não encontrado" (teste: Task 3, Step 10).

---

### Task 1: Backend das notas (tabela, funções, comandos)

**Files:**
- Modify: `src-tauri/src/db.rs` (struct `Note`, `DbError`, `SCHEMA`, funções novas, testes)
- Modify: `src-tauri/src/lib.rs` (4 comandos + registro no `generate_handler!`)

**Interfaces:**
- Consumes: padrão existente `with_conn`, `ensure_changed`, `DbError`.
- Produces (usado pela Task 3 via `invoke`):
  - `list_notes() -> Note[]` (mais nova primeiro)
  - `create_note({ body: string }) -> Note`
  - `update_note({ id: number, body: string }) -> Note`
  - `delete_note({ id: number }) -> void`
  - `Note` serializado como `{ id: number, body: string, created_at: string, updated_at: string }`, datas UTC no formato `YYYY-MM-DD HH:MM:SS.SSS`.
  - Erros: `"A nota não pode ficar vazia."`, `"A nota passou do limite de 10.000 caracteres."`, `"Registro não encontrado."`.

- [ ] **Step 1: Escrever os testes que falham**

Em `src-tauri/src/db.rs`, dentro de `mod tests`, depois do teste `missing_ids_return_not_found`, adicionar:

```rust
    fn bodies(conn: &Connection) -> Vec<String> {
        list_notes(conn).unwrap().into_iter().map(|n| n.body).collect()
    }

    #[test]
    fn creates_and_lists_notes_newest_first() {
        let c = mem();
        create_note(&c, "primeira").unwrap();
        create_note(&c, "segunda").unwrap();
        assert_eq!(bodies(&c), vec!["segunda", "primeira"]);
    }

    #[test]
    fn note_body_is_stored_exactly_as_typed() {
        let c = mem();
        let body = "linha 1\nlinha 2\n\n  recuada\n";
        let note = create_note(&c, body).unwrap();
        assert_eq!(note.body, body);
        assert_eq!(bodies(&c), vec![body]);
    }

    #[test]
    fn rejects_blank_and_too_long_note_bodies() {
        let c = mem();
        assert!(matches!(create_note(&c, ""), Err(DbError::EmptyBody)));
        assert!(matches!(create_note(&c, "  \n\n\t "), Err(DbError::EmptyBody)));
        assert!(matches!(create_note(&c, &"x".repeat(10_001)), Err(DbError::BodyTooLong)));
        // The limit counts characters, not bytes.
        create_note(&c, &"é".repeat(10_000)).unwrap();
        assert!(matches!(create_note(&c, &"é".repeat(10_001)), Err(DbError::BodyTooLong)));

        let id = create_note(&c, "ok").unwrap().id;
        assert!(matches!(update_note(&c, id, " \n "), Err(DbError::EmptyBody)));
        assert!(matches!(update_note(&c, id, &"x".repeat(10_001)), Err(DbError::BodyTooLong)));
        assert_eq!(bodies(&c)[0], "ok");
    }

    #[test]
    fn update_note_changes_body_and_updated_at_only() {
        let c = mem();
        let created = create_note(&c, "antes").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let updated = update_note(&c, created.id, "depois").unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.body, "depois");
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.updated_at > created.updated_at);
        assert_eq!(bodies(&c), vec!["depois"]);
    }

    #[test]
    fn delete_note_removes_it() {
        let c = mem();
        let a = create_note(&c, "a").unwrap().id;
        create_note(&c, "b").unwrap();
        delete_note(&c, a).unwrap();
        assert_eq!(bodies(&c), vec!["b"]);
    }

    #[test]
    fn missing_note_ids_return_not_found() {
        let c = mem();
        assert!(matches!(update_note(&c, 99, "x"), Err(DbError::NotFound)));
        assert!(matches!(delete_note(&c, 99), Err(DbError::NotFound)));
    }
```

- [ ] **Step 2: Rodar e ver falhar**

Run (PowerShell): `cd src-tauri; cargo test`
Expected: erro de compilação — `cannot find function list_notes`, `create_note`, `update_note`, `delete_note` e `no variant EmptyBody`/`BodyTooLong`.

- [ ] **Step 3: Implementar em `db.rs`**

3a. Depois da struct `Task`, adicionar:

```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Note {
    pub id: i64,
    pub body: String,
    /// UTC, "YYYY-MM-DD HH:MM:SS.SSS".
    pub created_at: String,
    pub updated_at: String,
}

pub const NOTE_MAX_CHARS: usize = 10_000;
```

3b. Substituir o enum `DbError` e seu `Display` por:

```rust
#[derive(Debug)]
pub enum DbError {
    Sqlite(rusqlite::Error),
    EmptyTitle,
    EmptyBody,
    BodyTooLong,
    NotFound,
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "Erro no banco de dados: {e}"),
            DbError::EmptyTitle => write!(f, "O título não pode ser vazio."),
            DbError::EmptyBody => write!(f, "A nota não pode ficar vazia."),
            DbError::BodyTooLong => write!(f, "A nota passou do limite de 10.000 caracteres."),
            DbError::NotFound => write!(f, "Registro não encontrado."),
        }
    }
}
```

3c. No fim da string `SCHEMA`, logo antes do `";` final (depois de `CREATE INDEX ...;`), adicionar:

```sql

CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
```

3d. Antes de `#[cfg(test)]`, adicionar:

```rust
/// Blank bodies are refused; the text itself is stored exactly as typed.
fn check_body(body: &str) -> Result<()> {
    if body.trim().is_empty() {
        Err(DbError::EmptyBody)
    } else if body.chars().count() > NOTE_MAX_CHARS {
        Err(DbError::BodyTooLong)
    } else {
        Ok(())
    }
}

fn note_from_row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        body: r.get(1)?,
        created_at: r.get(2)?,
        updated_at: r.get(3)?,
    })
}

fn get_note(conn: &Connection, id: i64) -> Result<Note> {
    conn.query_row(
        "SELECT id, body, created_at, updated_at FROM notes WHERE id = ?1",
        [id],
        note_from_row,
    )
    .optional()?
    .ok_or(DbError::NotFound)
}

/// Newest first.
pub fn list_notes(conn: &Connection) -> Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, body, created_at, updated_at FROM notes
         ORDER BY created_at DESC, id DESC",
    )?;
    let notes = stmt
        .query_map([], note_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(notes)
}

pub fn create_note(conn: &Connection, body: &str) -> Result<Note> {
    check_body(body)?;
    conn.execute("INSERT INTO notes (body) VALUES (?1)", [body])?;
    get_note(conn, conn.last_insert_rowid())
}

pub fn update_note(conn: &Connection, id: i64, body: &str) -> Result<Note> {
    check_body(body)?;
    ensure_changed(conn.execute(
        "UPDATE notes SET body = ?1, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
         WHERE id = ?2",
        params![body, id],
    )?)?;
    get_note(conn, id)
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<()> {
    ensure_changed(conn.execute("DELETE FROM notes WHERE id = ?1", [id])?)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (PowerShell): `cd src-tauri; cargo test`
Expected: `test result: ok. 14 passed` (8 antigos + 6 novos).

- [ ] **Step 5: Expor os comandos em `lib.rs`**

Trocar `use db::Task;` por `use db::{Note, Task};`. Depois de `set_subtask_completed`, adicionar:

```rust
#[tauri::command]
fn list_notes(state: State<AppState>) -> CmdResult<Vec<Note>> {
    with_conn(&state, |c| db::list_notes(c))
}

#[tauri::command]
fn create_note(state: State<AppState>, body: String) -> CmdResult<Note> {
    with_conn(&state, |c| db::create_note(c, &body))
}

#[tauri::command]
fn update_note(state: State<AppState>, id: i64, body: String) -> CmdResult<Note> {
    with_conn(&state, |c| db::update_note(c, id, &body))
}

#[tauri::command]
fn delete_note(state: State<AppState>, id: i64) -> CmdResult<()> {
    with_conn(&state, |c| db::delete_note(c, id))
}
```

No `generate_handler!`, depois de `set_subtask_completed` adicionar `list_notes, create_note, update_note, delete_note` (com vírgula após `set_subtask_completed`).

- [ ] **Step 6: Verificar build e testes**

Run (PowerShell): `cd src-tauri; cargo test; cargo build`
Expected: `14 passed`, build sem warnings novos.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(notes): notes table and Tauri commands"
```

---

### Task 2: Moldura do caderno aberto (tarefas à esquerda, página direita vazia)

**Files:**
- Create: `src/TodoPage.tsx` (lógica atual de tarefas, sem mudar comportamento)
- Modify: `src/App.tsx` (vira a moldura do caderno + toast)
- Modify: `src/components/ConfirmDialog.tsx` (prop `cancelLabel`)
- Modify: `src/components/DayHeader.tsx` (exportar `MARKER_PATH`)
- Modify: `src/App.css` (mesa, caderno, lombada, páginas com rolagem própria)
- Modify: `src-tauri/tauri.conf.json` (tamanho da janela)
- Tool (não commitado): `<scratch>/cdp.mjs`, onde `<scratch>` = `C:\Users\jcsilva\AppData\Local\Temp\claude\C--Users-jcsilva-source-repos-Todo-App\e984f786-af58-4c0d-b185-8ce603b2b50c\scratchpad`

**Interfaces:**
- Consumes: nada das outras tasks.
- Produces (usado pela Task 3):
  - `ConfirmDialog` props: `{ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }`.
  - `export const MARKER_PATH: string` em `src/components/DayHeader.tsx`.
  - Em `App.tsx`, a página direita é `<section className="sheet sheet-right" aria-label="Notas">` e o erro compartilhado é `setError: (message: string | null) => void`.
  - Classes CSS `.sheet`, `.sheet-left`, `.sheet-right` (cada uma rola sozinha, com `container-type: inline-size`).

- [ ] **Step 1: `ConfirmDialog` com rótulo de cancelar configurável**

Em `src/components/ConfirmDialog.tsx`: adicionar `cancelLabel: string;` à interface `Props` (depois de `confirmLabel`), desestruturar `cancelLabel` na assinatura e trocar o texto fixo `Manter tarefa` por `{cancelLabel}`.

- [ ] **Step 2: Exportar o traço do marca-texto**

Em `src/components/DayHeader.tsx`, trocar `const MARKER_PATH =` por `export const MARKER_PATH =`.

- [ ] **Step 3: Criar `src/TodoPage.tsx`**

Conteúdo completo (é o corpo atual de `App.tsx`; o estado de erro vira a prop `setError`, e o `ConfirmDialog` recebe `cancelLabel`):

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { api, type Task } from "./api";
import { useFlip } from "./hooks/useFlip";
import { DayHeader } from "./components/DayHeader";
import { TaskItem, type TaskActions } from "./components/TaskItem";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PlusIcon } from "./components/Icons";

interface Props {
  /** Shows a message in the shared error toast; null clears it. */
  setError: (message: string | null) => void;
}

/** Left page of the notebook: today's tasks. */
export function TodoPage({ setError }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const flip = useFlip(tasks);

  const reload = useCallback(async () => {
    try {
      const next = await api.listTasks();
      flip.snapshot();
      setTasks(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, [flip.snapshot, setError]);

  // Runs a mutation and then refreshes from the database, which is the source of truth.
  const run = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        await op();
        setError(null);
      } catch (e) {
        setError(String(e));
      }
      await reload();
    },
    [reload, setError],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const active = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    const from = active.findIndex((t) => t.id === dragged.id);
    const to = active.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(active, from, to);
    flip.snapshot();
    setTasks([...reordered, ...done]); // optimistic, avoids a jump back while saving
    run(() => api.reorderTasks(reordered.map((t) => t.id)));
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    run(() => api.createTask(title));
  };

  const actions: TaskActions = {
    onToggle: (id, completed) => run(() => api.setTaskCompleted(id, completed)),
    onRename: (id, title) => run(() => api.updateTask(id, title)),
    onDelete: (task) => setPendingDelete(task),
    onAddSubtask: (taskId, title) => run(() => api.createSubtask(taskId, title)),
    onToggleSubtask: (id, completed) => run(() => api.setSubtaskCompleted(id, completed)),
    onRenameSubtask: (id, title) => run(() => api.updateSubtask(id, title)),
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    const restore = await flip.animateOut(id);
    await run(() => api.deleteTask(id));
    restore(); // no-op once the row is gone; brings it back if the delete failed
  };

  const subCount = pendingDelete?.subtasks.length ?? 0;

  return (
    <>
      <DayHeader pending={active.length} done={done.length} />

      <form className="compose" onSubmit={addTask}>
        <span className="compose-icon" aria-hidden="true">
          <PlusIcon />
        </span>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Escreva uma tarefa e tecle Enter"
          aria-label="Nova tarefa"
          maxLength={200}
          autoFocus
        />
        <button className="compose-submit" type="submit" disabled={!newTitle.trim()}>
          Adicionar
        </button>
      </form>

      {loaded && tasks.length === 0 && (
        <p className="empty">Página em branco. A primeira tarefa entra na linha acima.</p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <ul className="rows" aria-label="Tarefas por fazer">
          <SortableContext items={active.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {active.map((t) => (
              <TaskItem key={t.id} task={t} flipRef={flip.register(t.id)} {...actions} />
            ))}
          </SortableContext>
        </ul>
      </DndContext>

      {done.length > 0 && (
        <section className="done" aria-labelledby="done-heading">
          <h2 id="done-heading" className="done-heading" ref={flip.register("done")}>
            Feitas <span className="done-count">{done.length}</span>
          </h2>
          <ul className="rows">
            {done.map((t) => (
              <TaskItem key={t.id} task={t} flipRef={flip.register(t.id)} {...actions} />
            ))}
          </ul>
        </section>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir esta tarefa?"
          message={`"${pendingDelete.title}"${
            subCount === 0 ? "" : subCount === 1 ? " e sua subtarefa" : ` e suas ${subCount} subtarefas`
          } ${subCount === 0 ? "será apagada" : "serão apagadas"} de vez. Não dá para desfazer.`}
          confirmLabel="Excluir tarefa"
          cancelLabel="Manter tarefa"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Reescrever `src/App.tsx` como moldura do caderno**

```tsx
import { useState } from "react";
import { TodoPage } from "./TodoPage";
import { CloseIcon } from "./components/Icons";
import "./App.css";

/** An open notebook on a dark desk: tasks on the left page, notes on the right. */
export default function App() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="desk">
      <div className="notebook">
        <main className="sheet sheet-left" aria-label="Tarefas">
          <TodoPage setError={setError} />
        </main>
        <div className="spine" aria-hidden="true" />
        <section className="sheet sheet-right" aria-label="Notas" />
      </div>

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="act" onClick={() => setError(null)} aria-label="Fechar aviso">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: CSS do caderno em `src/App.css`**

5a. No bloco `:root`, depois de `--danger: #e5645a;`, adicionar:

```css
  --desk: #0a0e15; /* the table under the notebook */
  --spine: #0d121b;
```

5b. No `body`, trocar a última linha do `background` de `var(--ink);` para `var(--desk);`.

5c. Trocar o seletor `button,\ninput {` por `button,\ninput,\ntextarea {`.

5d. Substituir a seção inteira `/* ---------- Page & margin line ---------- */` (regras `.page`, `.sheet` e `.sheet::before`) por:

```css
/* ---------- Desk & open notebook ---------- */

.desk {
  height: 100vh;
  display: flex;
  justify-content: center;
  padding: 22px 28px 34px;
}

.notebook {
  flex: 1;
  max-width: 1320px;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr);
  border-radius: 14px;
  box-shadow:
    0 0 0 1px #1f2839, /* page edge */
    0 5px 0 -1px #151c28, /* stacked sheets underneath */
    0 9px 0 -2px #10161f,
    0 36px 70px -24px rgba(0, 0, 0, 0.85);
}

/* Each page scrolls on its own; backgrounds stay put while the content moves. */
.sheet {
  --margin-x: calc(20px + var(--gutter) - 10px);
  --margin-line: linear-gradient(
    to right,
    transparent var(--margin-x),
    rgba(217, 105, 95, 0.45) var(--margin-x),
    rgba(217, 105, 95, 0.45) calc(var(--margin-x) + 1px),
    transparent calc(var(--margin-x) + 1px)
  );
  position: relative;
  min-width: 0;
  overflow-y: auto;
  container-type: inline-size;
  padding: 44px 28px 72px 20px;
}

/* Paper curving into the spine */
.sheet-left {
  border-radius: 14px 0 0 14px;
  background: linear-gradient(to left, rgba(0, 0, 0, 0.34), transparent 60px), var(--margin-line), var(--ink);
}

.sheet-right {
  border-radius: 0 14px 14px 0;
  background: linear-gradient(to right, rgba(0, 0, 0, 0.34), transparent 60px), var(--margin-line), var(--ink);
}

.spine {
  position: relative;
  background: linear-gradient(
      to right,
      rgba(0, 0, 0, 0.5),
      rgba(0, 0, 0, 0.12) 40%,
      rgba(0, 0, 0, 0.12) 60%,
      rgba(0, 0, 0, 0.5)
    ),
    var(--spine);
}

/* Binding stitches */
.spine::after {
  content: "";
  position: absolute;
  top: 26px;
  bottom: 26px;
  left: 50%;
  width: 1px;
  background: repeating-linear-gradient(to bottom, rgba(235, 230, 217, 0.16) 0 9px, transparent 9px 18px);
}
```

5e. Em `.day-title`, trocar `font-size: clamp(2.1rem, 5.4vw, 2.9rem);` por `font-size: clamp(1.9rem, 7.5cqi, 2.9rem);` (escala pela largura da página, não da janela).

5f. Apagar a seção inteira `/* ---------- Small windows ---------- */` (o `@media (max-width: 560px)`), que não se aplica mais com `minWidth` 900 e referenciava `.sheet::before`, que deixou de existir.

- [ ] **Step 6: Tamanho da janela**

Em `src-tauri/tauri.conf.json`, na janela: `"width": 1280`, `"height": 820`, `"minWidth": 900`, `"minHeight": 560`.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: `tsc` sem erros e `vite build` concluído.

- [ ] **Step 8: Criar o helper de CDP (não vai para o repositório)**

Criar `<scratch>/cdp.mjs`:

```js
// Drives the Tauri WebView2 window over CDP (app launched with --remote-debugging-port=9222).
// node cdp.mjs shot out.png | eval "<js>" | type "<text>" | key Enter|Ctrl+S | click "<css selector>" | wait <ms>
import { writeFileSync } from "node:fs";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "wait") {
  await new Promise((r) => setTimeout(r, Number(arg)));
  process.exit(0);
}

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let seq = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onMsg);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  "Ctrl+S": { key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 },
};

if (cmd === "shot") {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(arg, Buffer.from(data, "base64"));
  console.log("saved", arg);
} else if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.exceptionDetails ?? r.result.value, null, 2));
} else if (cmd === "type") {
  await send("Input.insertText", { text: arg });
} else if (cmd === "key") {
  const { text, ...k } = KEYS[arg];
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...k, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
} else if (cmd === "click") {
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const b = document.querySelector(${JSON.stringify(arg)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`,
    returnByValue: true,
  });
  const [x, y] = r.result.value;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}
ws.close();
```

- [ ] **Step 9: Subir o app com banco descartável**

Run (PowerShell, em background):

```powershell
Remove-Item "$env:TEMP\todo-notes-test.db*" -ErrorAction SilentlyContinue
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; $env:TODO_APP_DB="$env:TEMP\todo-notes-test.db"; npm run tauri dev
```

Esperar até `http://127.0.0.1:9222/json` responder (`node <scratch>/cdp.mjs eval "1"` imprime `1`).

- [ ] **Step 10: Verificar a moldura e que as tarefas continuam funcionando**

```powershell
node <scratch>/cdp.mjs eval "[...document.querySelectorAll('.sheet')].map(s => Math.round(s.getBoundingClientRect().width))"
```
Expected: duas larguras iguais (± 1 px).

```powershell
node <scratch>/cdp.mjs click "input[aria-label='Nova tarefa']"
node <scratch>/cdp.mjs type "Tarefa de teste"
node <scratch>/cdp.mjs key Enter
node <scratch>/cdp.mjs wait 800
node <scratch>/cdp.mjs eval "document.querySelectorAll('.sheet-left .row').length"
node <scratch>/cdp.mjs shot <scratch>/task2-notebook.png
```
Expected: `1`. Abrir o PNG com a ferramenta Read: caderno centralizado sobre a mesa, lombada com pontos no meio, sombra nas páginas perto da lombada, margem coral nas duas páginas, página direita vazia.

Fechar o app (Ctrl+C no processo em background, ou encerrar `todo-app.exe`).

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx src/TodoPage.tsx src/App.css src/components/ConfirmDialog.tsx src/components/DayHeader.tsx src-tauri/tauri.conf.json
git commit -m "feat(ui): open-notebook layout with tasks on the left page"
```

---

### Task 3: Página de notas (autosave, Salvar, Ctrl+S, excluir)

**Files:**
- Modify: `src/api.ts` (tipo `Note`, `NOTE_MAX_CHARS`, 4 wrappers)
- Create: `src/hooks/useAutosave.ts`
- Create: `src/components/NotesHeader.tsx`
- Create: `src/components/NoteItem.tsx`
- Create: `src/NotesPage.tsx`
- Modify: `src/App.tsx` (montar `NotesPage` na página direita)
- Modify: `src/App.css` (estilos das notas)

**Interfaces:**
- Consumes: comandos da Task 1; `ConfirmDialog` com `cancelLabel`, `MARKER_PATH`, `.sheet-right` e `setError` da Task 2; `TrashIcon`, `PlusIcon` de `Icons.tsx`.
- Produces:
  - `api.listNotes(): Promise<Note[]>`, `api.createNote(body): Promise<Note>`, `api.updateNote(id, body): Promise<Note>`, `api.deleteNote(id): Promise<void>`
  - `useAutosave(save: (value: string) => Promise<void>, onError: (message: string) => void, delay?: number): { status: SaveStatus; change(value): void; flush(): void; discard(): void }`
  - `NotesPage({ onError: (message: string) => void })`

- [ ] **Step 1: API tipada em `src/api.ts`**

Depois da interface `Task`:

```ts
export interface Note {
  id: number;
  body: string;
  /** UTC, "YYYY-MM-DD HH:MM:SS.SSS" */
  created_at: string;
  updated_at: string;
}

export const NOTE_MAX_CHARS = 10_000;
```

Dentro de `api`, depois de `setSubtaskCompleted`:

```ts
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (body: string) => invoke<Note>("create_note", { body }),
  updateNote: (id: number, body: string) => invoke<Note>("update_note", { id, body }),
  deleteNote: (id: number) => invoke<void>("delete_note", { id }),
```

- [ ] **Step 2: Criar `src/hooks/useAutosave.ts`**

```ts
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
```

- [ ] **Step 3: Criar `src/components/NotesHeader.tsx`**

```tsx
import { MARKER_PATH } from "./DayHeader";

function summary(count: number) {
  if (count === 0) return "Nada anotado ainda.";
  return count === 1 ? "1 nota." : `${count} notas.`;
}

/** Right page title, underlined by a static marker stroke. */
export function NotesHeader({ count }: { count: number }) {
  return (
    <header className="day">
      <h2 className="day-title">Notas</h2>
      <svg className="day-marker" viewBox="0 0 300 14" aria-hidden="true">
        <path className="day-marker-fill" d={MARKER_PATH} />
      </svg>
      <p className="day-summary">{summary(count)}</p>
    </header>
  );
}
```

- [ ] **Step 4: Criar `src/components/NoteItem.tsx`**

```tsx
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
```

- [ ] **Step 5: Criar `src/NotesPage.tsx`**

```tsx
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
```

- [ ] **Step 6: Montar na página direita e estilizar**

6a. Em `src/App.tsx`: importar `import { NotesPage } from "./NotesPage";` e trocar
`<section className="sheet sheet-right" aria-label="Notas" />` por:

```tsx
        <section className="sheet sheet-right" aria-label="Notas">
          <NotesPage onError={setError} />
        </section>
```

6b. Em `src/App.css`, logo antes de `/* ---------- Toast ---------- */`, adicionar:

```css
/* ---------- Notes ---------- */

/* "Nova nota" reuses the compose line look as a button. */
.compose-button {
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  border-bottom: 1px solid var(--rule);
  text-align: left;
  color: var(--text-faint);
  transition: color 0.2s;
}

.compose-button:hover,
.compose-button:focus-visible {
  color: var(--text);
  outline: none; /* the marker underline and the turning + show focus */
}

.compose-label {
  padding: 16px 0;
  font-size: 1.08rem;
}

.notes {
  list-style: none;
  margin: 0;
  padding: 0;
}

.note {
  --line: 28px;
  padding: 12px 0 10px var(--gutter);
  border-bottom: 1px solid var(--rule);
  animation: note-in 0.35s var(--ease);
}

.note-leaving {
  animation: note-out 0.22s ease-in forwards;
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  font-size: 0.82rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.note-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s;
}

.note:hover .note-actions,
.note:focus-within .note-actions {
  opacity: 1;
}

.note-save {
  padding: 4px 10px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--marker);
  font-weight: 600;
  transition: background-color 0.15s;
}

.note-save:hover {
  background: rgba(244, 201, 93, 0.1);
}

/* Text sits on the ruled lines: line-height matches the rule spacing. */
.note-text {
  display: block;
  width: 100%;
  min-height: calc(var(--line) * 2);
  margin: 0;
  padding: 0;
  resize: none;
  overflow: hidden;
  border: none;
  outline: none;
  font-size: 1rem;
  line-height: var(--line);
  caret-color: var(--marker);
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(var(--line) - 1px),
    var(--rule) calc(var(--line) - 1px),
    var(--rule) var(--line)
  );
  background-attachment: local;
}

.note-text::placeholder {
  color: var(--text-faint);
}

@keyframes note-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@keyframes note-out {
  to {
    opacity: 0;
    transform: translateX(12px);
  }
}
```

- [ ] **Step 7: Build e verificação no app — criar, Enter, autosave, sem duplicata (Review Focus 3)**

Run: `npm run build` → Expected: sem erros.

Subir o app como na Task 2, Step 9 (banco descartável zerado). Então:

```powershell
node <scratch>/cdp.mjs click ".compose-button"
node <scratch>/cdp.mjs type "Primeira linha"
node <scratch>/cdp.mjs key Enter
node <scratch>/cdp.mjs type "Segunda linha"
node <scratch>/cdp.mjs click ".sheet-left .day-title"
node <scratch>/cdp.mjs wait 1500
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => n.map(x => x.body))"
```
Expected: `["Primeira linha\nSegunda linha"]` — **uma** nota (blur e timer não geraram duplicata), com a quebra de linha que o Enter inseriu.

Autosave sem sair da nota:

```powershell
node <scratch>/cdp.mjs click ".note-text"
node <scratch>/cdp.mjs type " + mais"
node <scratch>/cdp.mjs eval "document.querySelector('.note-save') !== null"
node <scratch>/cdp.mjs wait 1600
node <scratch>/cdp.mjs eval "[document.querySelector('.note-status').textContent, document.querySelector('.note-save') === null]"
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => n[0].body)"
```
Expected: `true` (Salvar aparece com mudanças), depois `["Salvo", true]` e o corpo terminando em `" + mais"`.

Ctrl+S:

```powershell
node <scratch>/cdp.mjs type "!"
node <scratch>/cdp.mjs key Ctrl+S
node <scratch>/cdp.mjs wait 300
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => n[0].body.endsWith('!'))"
```
Expected: `true` antes de passar 1 s.

Rascunho vazio some:

```powershell
node <scratch>/cdp.mjs click ".compose-button"
node <scratch>/cdp.mjs click ".sheet-left .day-title"
node <scratch>/cdp.mjs eval "document.querySelectorAll('.note').length"
```
Expected: `1`.

- [ ] **Step 8: Apagar todo o texto e sair (Review Focus 1)**

```powershell
node <scratch>/cdp.mjs click ".note-text"
node <scratch>/cdp.mjs eval "document.execCommand('selectAll'); document.execCommand('delete'); document.querySelector('.note-text').value"
node <scratch>/cdp.mjs click ".sheet-left .day-title"
node <scratch>/cdp.mjs wait 1500
node <scratch>/cdp.mjs eval "[document.querySelector('.note-text').value, document.querySelectorAll('.note').length]"
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => n[0].body)"
```
Expected: o `execCommand` deixa o campo `""`; depois do blur, o campo volta ao último texto salvo (terminando em `!`), continua `1` nota, e o banco tem o mesmo texto.

- [ ] **Step 9: Digitar durante um salvamento (Review Focus 2)**

```powershell
node <scratch>/cdp.mjs click ".note-text"
node <scratch>/cdp.mjs eval "(() => { const t = document.querySelector('.note-text'); t.setSelectionRange(t.value.length, t.value.length); return true })()"
node <scratch>/cdp.mjs type " A"
node <scratch>/cdp.mjs key Ctrl+S
node <scratch>/cdp.mjs type " B"
node <scratch>/cdp.mjs type " C"
node <scratch>/cdp.mjs wait 1600
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => [n.length, n[0].body.endsWith(' A B C')])"
```
Expected: `[1, true]` — o último texto chegou ao banco e nenhuma nota a mais foi criada.

- [ ] **Step 10: Excluir logo depois de editar (Review Focus 5)**

```powershell
node <scratch>/cdp.mjs type " D"
node <scratch>/cdp.mjs click ".note .act-danger"
node <scratch>/cdp.mjs eval "document.querySelector('.dialog h2').textContent"
node <scratch>/cdp.mjs click ".dialog .btn-danger"
node <scratch>/cdp.mjs wait 600
node <scratch>/cdp.mjs eval "[document.querySelectorAll('.note').length, document.querySelector('.toast')?.textContent ?? null]"
node <scratch>/cdp.mjs eval "window.__TAURI_INTERNALS__.invoke('list_notes').then(n => n.length)"
```
Expected: `"Excluir esta nota?"`, depois `[0, null]` (sem toast de erro) e `0` no banco. A frase "Nenhuma nota ainda…" aparece.

- [ ] **Step 11: Visual**

Criar três notas (uma com ~15 linhas), então:

```powershell
node <scratch>/cdp.mjs shot <scratch>/task3-notes.png
```
Abrir com Read. Conferir: texto em cima da pauta (sem linha cortando letras), nota longa cresce sem barra de rolagem interna, página direita rola sozinha, data/hora em cinza acima de cada nota, cabeçalho "Notas" com o traço amarelo e a contagem certa.

Fechar o app.

- [ ] **Step 12: Commit**

```bash
git add src/api.ts src/hooks/useAutosave.ts src/components/NotesHeader.tsx src/components/NoteItem.tsx src/NotesPage.tsx src/App.tsx src/App.css
git commit -m "feat(notes): notes page with autosave on the right page"
```

---

### Task 4: README e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–3.
- Produces: documentação atualizada.

- [ ] **Step 1: Atualizar `README.md`**

Na primeira linha de descrição, trocar `Aplicativo desktop de tarefas com subtarefas` por `Aplicativo desktop de tarefas com subtarefas e notas`.

Em **Funcionalidades**, depois do item de reordenação, adicionar:

```markdown
- **Notas** na página da direita: criar ("+ Nova nota") e excluir (com confirmação). O texto é livre: Enter pula linha. Salvamento automático ~1 s depois de parar de digitar e ao sair da nota; também pelo botão **Salvar** ou `Ctrl+S`. Uma nota nova só é gravada quando tem texto; apagar todo o texto de uma nota existente não a exclui (ela volta ao último conteúdo salvo). Limite de 10.000 caracteres.
- Layout de **caderno aberto**: tarefas na página esquerda, notas na direita, cada página com rolagem própria.
```

No item do tema, trocar `Tema escuro fixo, no conceito "caderno à noite"` por `Tema escuro fixo, no conceito "caderno à noite" aberto sobre uma mesa`.

Em **Estrutura**, substituir o bloco de código por:

```
src-tauri/src/db.rs          # schema SQLite (tarefas, subtarefas, notas), operações e testes
src-tauri/src/lib.rs         # comandos Tauri expostos ao frontend
src/api.ts                   # wrappers tipados de invoke()
src/App.tsx                  # moldura do caderno aberto e aviso de erro
src/TodoPage.tsx             # página de tarefas: lista, drag-and-drop, exclusão
src/NotesPage.tsx            # página de notas: lista, nova nota, exclusão
src/components/NoteItem.tsx  # uma nota: texto, salvar, excluir
src/hooks/useAutosave.ts     # salvamento automático com debounce
src/hooks/useFlip.ts         # animação FLIP (entrada, reordenação, saída)
```

(Se o README tiver linhas depois de `useFlip.ts` dentro do bloco, mantê-las.)

- [ ] **Step 2: Verificação completa**

Run (PowerShell): `cd src-tauri; cargo test` → Expected: `14 passed`.
Run: `npm run build` → Expected: sem erros.
Subir o app com banco descartável (Task 2, Step 9) e confirmar numa captura: tarefas criadas, concluídas e arrastadas funcionam na página esquerda enquanto há notas na direita; o toast de erro aparece centralizado na janela.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document notes page and notebook layout"
```
