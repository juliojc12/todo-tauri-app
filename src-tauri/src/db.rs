use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Subtask {
    pub id: i64,
    pub task_id: i64,
    pub title: String,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub completed: bool,
    pub subtasks: Vec<Subtask>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Note {
    pub id: i64,
    pub body: String,
    /// UTC, "YYYY-MM-DD HH:MM:SS.SSS".
    pub created_at: String,
    pub updated_at: String,
}

pub const NOTE_MAX_CHARS: usize = 10_000;

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

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL,
    completed_at TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subtasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    completed  INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);

CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
";

fn clean_title(title: &str) -> Result<String> {
    let t = title.trim();
    if t.is_empty() {
        Err(DbError::EmptyTitle)
    } else {
        Ok(t.to_string())
    }
}

fn ensure_changed(rows: usize) -> Result<()> {
    if rows == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub fn open(path: &Path) -> Result<Connection> {
    init(Connection::open(path)?)
}

pub fn init(conn: Connection) -> Result<Connection> {
    // Foreign keys are off by default in SQLite; needed for ON DELETE CASCADE.
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// Active tasks first (by user-defined position), completed tasks last (by completion order).
pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, completed FROM tasks
         ORDER BY completed ASC,
                  CASE WHEN completed = 0 THEN position END ASC,
                  completed_at ASC, id ASC",
    )?;
    let mut tasks = stmt
        .query_map([], |r| {
            Ok(Task {
                id: r.get(0)?,
                title: r.get(1)?,
                completed: r.get(2)?,
                subtasks: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut sub_stmt = conn.prepare(
        "SELECT id, task_id, title, completed FROM subtasks
         WHERE task_id = ?1 ORDER BY position ASC, id ASC",
    )?;
    for task in &mut tasks {
        task.subtasks = sub_stmt
            .query_map([task.id], |r| {
                Ok(Subtask {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    title: r.get(2)?,
                    completed: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }
    Ok(tasks)
}

fn next_task_position(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks",
        [],
        |r| r.get(0),
    )?)
}

pub fn create_task(conn: &Connection, title: &str) -> Result<i64> {
    let title = clean_title(title)?;
    let pos = next_task_position(conn)?;
    conn.execute(
        "INSERT INTO tasks (title, position) VALUES (?1, ?2)",
        params![title, pos],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_task(conn: &Connection, id: i64, title: &str) -> Result<()> {
    let title = clean_title(title)?;
    ensure_changed(conn.execute(
        "UPDATE tasks SET title = ?1 WHERE id = ?2",
        params![title, id],
    )?)
}

pub fn set_task_completed(conn: &Connection, id: i64, completed: bool) -> Result<()> {
    let rows = if completed {
        conn.execute(
            "UPDATE tasks SET completed = 1, completed_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
             WHERE id = ?1",
            [id],
        )?
    } else {
        // A reopened task goes back to the end of the active list.
        let pos = next_task_position(conn)?;
        conn.execute(
            "UPDATE tasks SET completed = 0, completed_at = NULL, position = ?1 WHERE id = ?2",
            params![pos, id],
        )?
    };
    ensure_changed(rows)
}

/// Permanently removes the task; its subtasks are removed by ON DELETE CASCADE.
pub fn delete_task(conn: &Connection, id: i64) -> Result<()> {
    ensure_changed(conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?)
}

/// Assigns positions following the given order of task ids.
pub fn reorder_tasks(conn: &mut Connection, ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE tasks SET position = ?1 WHERE id = ?2")?;
        for (pos, id) in ids.iter().enumerate() {
            stmt.execute(params![pos as i64, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn create_subtask(conn: &Connection, task_id: i64, title: &str) -> Result<i64> {
    let title = clean_title(title)?;
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
        .optional()?;
    if exists.is_none() {
        return Err(DbError::NotFound);
    }
    let pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM subtasks WHERE task_id = ?1",
        [task_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO subtasks (task_id, title, position) VALUES (?1, ?2, ?3)",
        params![task_id, title, pos],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_subtask(conn: &Connection, id: i64, title: &str) -> Result<()> {
    let title = clean_title(title)?;
    ensure_changed(conn.execute(
        "UPDATE subtasks SET title = ?1 WHERE id = ?2",
        params![title, id],
    )?)
}

pub fn set_subtask_completed(conn: &Connection, id: i64, completed: bool) -> Result<()> {
    ensure_changed(conn.execute(
        "UPDATE subtasks SET completed = ?1 WHERE id = ?2",
        params![completed, id],
    )?)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn titles(conn: &Connection) -> Vec<String> {
        list_tasks(conn).unwrap().into_iter().map(|t| t.title).collect()
    }

    #[test]
    fn creates_and_lists_tasks_in_creation_order() {
        let c = mem();
        create_task(&c, "A").unwrap();
        create_task(&c, "  B  ").unwrap();
        assert_eq!(titles(&c), vec!["A", "B"]);
    }

    #[test]
    fn rejects_empty_titles() {
        let c = mem();
        assert!(matches!(create_task(&c, "   "), Err(DbError::EmptyTitle)));
        let id = create_task(&c, "A").unwrap();
        assert!(matches!(update_task(&c, id, ""), Err(DbError::EmptyTitle)));
        assert!(matches!(create_subtask(&c, id, " "), Err(DbError::EmptyTitle)));
    }

    #[test]
    fn updates_task_and_subtask_titles() {
        let c = mem();
        let t = create_task(&c, "A").unwrap();
        let s = create_subtask(&c, t, "s1").unwrap();
        update_task(&c, t, "A2").unwrap();
        update_subtask(&c, s, "s1-b").unwrap();
        let tasks = list_tasks(&c).unwrap();
        assert_eq!(tasks[0].title, "A2");
        assert_eq!(tasks[0].subtasks[0].title, "s1-b");
    }

    #[test]
    fn completed_tasks_go_to_end_and_reopened_return_to_active_end() {
        let c = mem();
        let a = create_task(&c, "A").unwrap();
        create_task(&c, "B").unwrap();
        create_task(&c, "C").unwrap();
        set_task_completed(&c, a, true).unwrap();
        assert_eq!(titles(&c), vec!["B", "C", "A"]);
        assert!(list_tasks(&c).unwrap()[2].completed);

        set_task_completed(&c, a, false).unwrap();
        assert_eq!(titles(&c), vec!["B", "C", "A"]);
        assert!(!list_tasks(&c).unwrap()[2].completed);
    }

    #[test]
    fn reorders_tasks() {
        let mut c = mem();
        let a = create_task(&c, "A").unwrap();
        let b = create_task(&c, "B").unwrap();
        let d = create_task(&c, "C").unwrap();
        reorder_tasks(&mut c, &[d, a, b]).unwrap();
        assert_eq!(titles(&c), vec!["C", "A", "B"]);
    }

    #[test]
    fn delete_task_removes_task_and_subtasks_from_database() {
        let c = mem();
        let t = create_task(&c, "A").unwrap();
        create_subtask(&c, t, "s1").unwrap();
        create_subtask(&c, t, "s2").unwrap();
        delete_task(&c, t).unwrap();
        let tasks: i64 = c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        let subs: i64 = c.query_row("SELECT COUNT(*) FROM subtasks", [], |r| r.get(0)).unwrap();
        assert_eq!((tasks, subs), (0, 0));
    }

    #[test]
    fn subtasks_can_be_toggled_and_are_ordered() {
        let c = mem();
        let t = create_task(&c, "A").unwrap();
        let s1 = create_subtask(&c, t, "s1").unwrap();
        create_subtask(&c, t, "s2").unwrap();
        set_subtask_completed(&c, s1, true).unwrap();
        let subs = &list_tasks(&c).unwrap()[0].subtasks;
        assert_eq!(subs.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), vec!["s1", "s2"]);
        assert!(subs[0].completed);
        assert!(!subs[1].completed);
    }

    #[test]
    fn missing_ids_return_not_found() {
        let c = mem();
        assert!(matches!(delete_task(&c, 99), Err(DbError::NotFound)));
        assert!(matches!(create_subtask(&c, 99, "x"), Err(DbError::NotFound)));
        assert!(matches!(set_subtask_completed(&c, 99, true), Err(DbError::NotFound)));
    }

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
}
