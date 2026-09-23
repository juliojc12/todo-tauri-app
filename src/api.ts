import { invoke } from "@tauri-apps/api/core";

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  completed: boolean;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  subtasks: Subtask[];
}

export interface Note {
  id: number;
  body: string;
  /** UTC, "YYYY-MM-DD HH:MM:SS.SSS" */
  created_at: string;
  updated_at: string;
}

export const NOTE_MAX_CHARS = 10_000;

export const api = {
  listTasks: () => invoke<Task[]>("list_tasks"),
  createTask: (title: string) => invoke<number>("create_task", { title }),
  updateTask: (id: number, title: string) => invoke<void>("update_task", { id, title }),
  setTaskCompleted: (id: number, completed: boolean) =>
    invoke<void>("set_task_completed", { id, completed }),
  deleteTask: (id: number) => invoke<void>("delete_task", { id }),
  reorderTasks: (ids: number[]) => invoke<void>("reorder_tasks", { ids }),
  createSubtask: (taskId: number, title: string) =>
    invoke<number>("create_subtask", { taskId, title }),
  updateSubtask: (id: number, title: string) => invoke<void>("update_subtask", { id, title }),
  setSubtaskCompleted: (id: number, completed: boolean) =>
    invoke<void>("set_subtask_completed", { id, completed }),
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (body: string) => invoke<Note>("create_note", { body }),
  updateNote: (id: number, body: string) => invoke<Note>("update_note", { id, body }),
  deleteNote: (id: number) => invoke<void>("delete_note", { id }),
};
