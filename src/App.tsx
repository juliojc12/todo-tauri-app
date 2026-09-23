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
import { CloseIcon, PlusIcon } from "./components/Icons";
import "./App.css";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [flip.snapshot]);

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
    [reload],
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
    <div className="page">
      <main className="sheet">
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
      </main>

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="act" onClick={() => setError(null)} aria-label="Fechar aviso">
            <CloseIcon />
          </button>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Excluir esta tarefa?"
          message={`"${pendingDelete.title}"${
            subCount === 0 ? "" : subCount === 1 ? " e sua subtarefa" : ` e suas ${subCount} subtarefas`
          } ${subCount === 0 ? "será apagada" : "serão apagadas"} de vez. Não dá para desfazer.`}
          confirmLabel="Excluir tarefa"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
