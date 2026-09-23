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
