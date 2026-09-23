import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../api";
import { InlineEdit } from "./InlineEdit";
import { Checkbox } from "./Checkbox";
import { ChevronIcon, EditIcon, GripIcon, TrashIcon } from "./Icons";

export interface TaskActions {
  onToggle: (id: number, completed: boolean) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (task: Task) => void;
  onAddSubtask: (taskId: number, title: string) => void;
  onToggleSubtask: (id: number, completed: boolean) => void;
  onRenameSubtask: (id: number, title: string) => void;
}

interface Props extends TaskActions {
  task: Task;
  flipRef: (el: HTMLElement | null) => void;
}

// Time for the check + marker strike to play before the row moves to its new place.
const SETTLE_MS = 480;

export function TaskItem({ task, flipRef, ...actions }: Props) {
  const [editing, setEditing] = useState(false);
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [newSub, setNewSub] = useState("");
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const subInputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: task.completed });

  useEffect(() => setOptimistic(null), [task.completed]);

  useEffect(() => {
    if (expanded && task.subtasks.length === 0) subInputRef.current?.focus();
    // Only when the panel opens.
  }, [expanded]);

  const checked = optimistic ?? task.completed;
  const locked = task.completed;
  const total = task.subtasks.length;
  const doneCount = task.subtasks.filter((s) => s.completed).length;

  const toggle = (value: boolean) => {
    setOptimistic(value);
    window.setTimeout(() => actions.onToggle(task.id, value), SETTLE_MS);
  };

  const addSubtask = () => {
    const title = newSub.trim();
    if (!title) return;
    actions.onAddSubtask(task.id, title);
    setNewSub("");
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`slot${isDragging ? " slot-dragging" : ""}`}
    >
      <div ref={flipRef} className={`row${locked ? " row-done" : ""}`}>
        <div className="row-main">
          <button
            ref={setActivatorNodeRef}
            className="grip"
            aria-label="Arrastar para reordenar"
            title="Arrastar para reordenar"
            disabled={locked}
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>

          <Checkbox
            checked={checked}
            onChange={toggle}
            label={task.completed ? "Reabrir tarefa" : "Concluir tarefa"}
          />

          <div className="row-body">
            {editing ? (
              <InlineEdit
                value={task.title}
                onSave={(t) => {
                  actions.onRename(task.id, t);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <span
                className={`title${checked ? " title-struck" : ""}`}
                onDoubleClick={() => !locked && setEditing(true)}
              >
                <span className="title-text">{task.title}</span>
              </span>
            )}

            {(total > 0 || !locked) && (
              <button
                className={`subs-toggle${total === 0 ? " subs-toggle-empty" : ""}`}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                <span className={`chev${expanded ? " chev-open" : ""}`}>
                  <ChevronIcon />
                </span>
                {total > 0 ? (
                  <>
                    <span className="subs-count">
                      {doneCount}/{total}
                    </span>
                    <span className="subs-meter" aria-hidden="true">
                      <span style={{ transform: `scaleX(${doneCount / total})` }} />
                    </span>
                  </>
                ) : (
                  "Subtarefas"
                )}
              </button>
            )}
          </div>

          <div className="row-actions">
            {!locked && (
              <button className="act" onClick={() => setEditing(true)} aria-label="Editar tarefa" title="Editar">
                <EditIcon />
              </button>
            )}
            <button
              className="act act-danger"
              onClick={() => actions.onDelete(task)}
              aria-label="Excluir tarefa"
              title="Excluir"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        <div className={`subs${expanded ? " subs-open" : ""}`} inert={!expanded}>
          <div className="subs-inner">
            {total > 0 && (
              <ul className="sub-list">
                {task.subtasks.map((s) => (
                  <li key={s.id} className="sub">
                    <Checkbox
                      small
                      checked={s.completed}
                      disabled={locked}
                      onChange={(v) => actions.onToggleSubtask(s.id, v)}
                      label="Concluir subtarefa"
                    />
                    {editingSubId === s.id ? (
                      <InlineEdit
                        value={s.title}
                        onSave={(t) => {
                          actions.onRenameSubtask(s.id, t);
                          setEditingSubId(null);
                        }}
                        onCancel={() => setEditingSubId(null)}
                      />
                    ) : (
                      <span
                        className={`title title-sub${s.completed ? " title-struck" : ""}`}
                        onDoubleClick={() => !locked && setEditingSubId(s.id)}
                      >
                        <span className="title-text">{s.title}</span>
                      </span>
                    )}
                    {!locked && editingSubId !== s.id && (
                      <button
                        className="act act-sm"
                        onClick={() => setEditingSubId(s.id)}
                        aria-label="Editar subtarefa"
                        title="Editar"
                      >
                        <EditIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {!locked && (
              <form
                className="sub-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSubtask();
                }}
              >
                <input
                  ref={subInputRef}
                  value={newSub}
                  onChange={(e) => setNewSub(e.target.value)}
                  placeholder="Adicionar subtarefa"
                  aria-label="Nova subtarefa"
                  maxLength={200}
                />
              </form>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
