mod db;

use db::Task;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    conn: Mutex<Connection>,
}

type CmdResult<T> = Result<T, String>;

fn with_conn<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut Connection) -> db::Result<T>,
) -> CmdResult<T> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    f(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> CmdResult<Vec<Task>> {
    with_conn(&state, |c| db::list_tasks(c))
}

#[tauri::command]
fn create_task(state: State<AppState>, title: String) -> CmdResult<i64> {
    with_conn(&state, |c| db::create_task(c, &title))
}

#[tauri::command]
fn update_task(state: State<AppState>, id: i64, title: String) -> CmdResult<()> {
    with_conn(&state, |c| db::update_task(c, id, &title))
}

#[tauri::command]
fn set_task_completed(state: State<AppState>, id: i64, completed: bool) -> CmdResult<()> {
    with_conn(&state, |c| db::set_task_completed(c, id, completed))
}

#[tauri::command]
fn delete_task(state: State<AppState>, id: i64) -> CmdResult<()> {
    with_conn(&state, |c| db::delete_task(c, id))
}

#[tauri::command]
fn reorder_tasks(state: State<AppState>, ids: Vec<i64>) -> CmdResult<()> {
    with_conn(&state, |c| db::reorder_tasks(c, &ids))
}

#[tauri::command]
fn create_subtask(state: State<AppState>, task_id: i64, title: String) -> CmdResult<i64> {
    with_conn(&state, |c| db::create_subtask(c, task_id, &title))
}

#[tauri::command]
fn update_subtask(state: State<AppState>, id: i64, title: String) -> CmdResult<()> {
    with_conn(&state, |c| db::update_subtask(c, id, &title))
}

#[tauri::command]
fn set_subtask_completed(state: State<AppState>, id: i64, completed: bool) -> CmdResult<()> {
    with_conn(&state, |c| db::set_subtask_completed(c, id, completed))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // TODO_APP_DB points the app at another database file (e.g. a throwaway one for testing).
            let path = match std::env::var_os("TODO_APP_DB") {
                Some(p) => std::path::PathBuf::from(p),
                None => {
                    let dir = app.path().app_data_dir()?;
                    std::fs::create_dir_all(&dir)?;
                    dir.join("todo.db")
                }
            };
            let conn = db::open(&path).map_err(|e| e.to_string())?;
            app.manage(AppState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            create_task,
            update_task,
            set_task_completed,
            delete_task,
            reorder_tasks,
            create_subtask,
            update_subtask,
            set_subtask_completed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
