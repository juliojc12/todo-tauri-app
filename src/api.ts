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
};
