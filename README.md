# Todo App

Aplicativo desktop de tarefas com subtarefas, feito com **Tauri v2 + Rust + React/TypeScript** e persistência em **SQLite**.

## Funcionalidades

- Criar tarefas e subtarefas (apenas título).
- Editar tarefas e subtarefas: duplo clique no título ou ícone de lápis (Enter salva, Esc cancela).
- Concluir tarefas: ficam com aparência de desativadas e vão para o final da lista. Desmarcar devolve a tarefa ao fim da lista de ativas.
- Concluir subtarefas (contador `feitas/total` na tarefa).
- Excluir tarefa **com confirmação**. A exclusão é física: a tarefa e suas subtarefas são removidas do banco (`ON DELETE CASCADE`). Subtarefas não podem ser excluídas.
- Reordenar tarefas ativas por drag-and-drop (mouse ou teclado: foco na alça, Espaço, setas, Espaço).
- Tema escuro fixo, no conceito "caderno à noite": linhas pautadas, margem coral e um marca-texto amarelo como único destaque. O traço sob a data mostra o progresso do dia, e concluir uma tarefa a risca com o marca-texto.
- Animações só em resposta a ações: o ✓ desenhado, o risco, a tarefa deslizando até "Feitas" (FLIP), o painel de subtarefas, a saída ao excluir e o diálogo. Todas são desligadas se o sistema estiver com "reduzir movimento" ativo.

## Pré-requisitos (Windows)

- Node.js 20+ e Rust (toolchain `stable-x86_64-pc-windows-msvc`)
- **Visual Studio / Build Tools com o workload "Desenvolvimento para desktop com C++"** (fornece o `link.exe` do MSVC)
- WebView2 (já vem no Windows 11)

> Rode os comandos no **PowerShell** ou no **Developer PowerShell**. No Git Bash, o `/usr/bin/link` sobrepõe o `link.exe` do MSVC e a compilação falha.

## Comandos

```powershell
npm install
npm run tauri dev             # desenvolvimento
npm run tauri build           # gera o instalador
cd src-tauri; cargo test      # testes da camada de dados
```

## Estrutura

```
src-tauri/src/db.rs    # schema SQLite, operações e testes unitários
src-tauri/src/lib.rs   # comandos Tauri expostos ao frontend
src/api.ts             # wrappers tipados de invoke()
src/App.tsx            # lista, drag-and-drop, diálogo de exclusão
src/hooks/useFlip.ts   # animação FLIP (entrada, reordenação, saída)
src/components/        # DayHeader, TaskItem, Checkbox, InlineEdit, ConfirmDialog, Icons
```

O banco fica em `%APPDATA%\com.jcsilva.todoapp\todo.db`. Para usar outro arquivo (por exemplo, um banco descartável para testes), defina `TODO_APP_DB`:

```powershell
$env:TODO_APP_DB = "C:\temp\teste.db"; npm run tauri dev
```
