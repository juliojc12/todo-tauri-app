import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  pending: number;
  done: number;
}

function summary(pending: number, done: number) {
  if (pending === 0 && done === 0) return "Nada anotado para hoje.";
  if (pending === 0) return `Tudo feito. ${done} ${done === 1 ? "tarefa concluída" : "tarefas concluídas"}.`;
  const p = `${pending} por fazer`;
  return done > 0 ? `${p}, ${done} ${done === 1 ? "feita" : "feitas"}.` : `${p}.`;
}

export const MARKER_PATH = "M3 8 C 60 4, 120 11, 180 7 S 270 5, 297 8";

/** Today's date as the page title, underlined by a marker stroke that fills with progress. */
export function DayHeader({ pending, done }: Props) {
  const total = pending + done;
  const target = total === 0 ? 0 : done / total;

  // Start empty and draw to the real value after mount, so the stroke is drawn on load.
  const [progress, setProgress] = useState(0);
  // Real path length: `pathLength` is not reliably applied to CSS dash values.
  const fillRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  useLayoutEffect(() => setLen(fillRef.current?.getTotalLength() ?? 0), []);
  useEffect(() => {
    const id = requestAnimationFrame(() => setProgress(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  const now = new Date();
  const weekday = now.toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");
  const date = now.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

  return (
    <header className="day">
      <h1 className="day-title">
        <span className="day-weekday">{weekday},</span> <span className="day-date">{date}</span>
      </h1>
      <svg
        className="day-marker"
        viewBox="0 0 300 14"
        role="progressbar"
        aria-label="Progresso do dia"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(target * 100)}
      >
        <path className="day-marker-track" d={MARKER_PATH} />
        <path
          ref={fillRef}
          className="day-marker-fill"
          d={MARKER_PATH}
          style={{
            strokeDasharray: `${len} ${len}`,
            strokeDashoffset: len * (1 - progress),
            visibility: len ? "visible" : "hidden",
          }}
        />
      </svg>
      <p className="day-summary">{summary(pending, done)}</p>
    </header>
  );
}
