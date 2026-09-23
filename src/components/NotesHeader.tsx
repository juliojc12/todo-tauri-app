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
