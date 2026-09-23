# Todo App

Aplicativo desktop de tarefas com subtarefas e notas, feito com **Tauri v2 + Rust + React/TypeScript** e persistência em **SQLite**.

## Funcionalidades

- Criar tarefas e subtarefas (apenas título).
- Editar tarefas e subtarefas: duplo clique no título ou ícone de lápis (Enter salva, Esc cancela).
- Concluir tarefas: ficam com aparência de desativadas e vão para o final da lista. Desmarcar devolve a tarefa ao fim da lista de ativas.
- Concluir subtarefas (contador `feitas/total` na tarefa).
- Excluir tarefa **com confirmação**. A exclusão é física: a tarefa e suas subtarefas são removidas do banco (`ON DELETE CASCADE`). Subtarefas não podem ser excluídas.
- Reordenar tarefas ativas por drag-and-drop (mouse ou teclado: foco na alça, Espaço, setas, Espaço).
- **Notas** na página da direita: criar ("+ Nova nota") e excluir (com confirmação). O texto é livre: Enter pula linha. Salvamento automático ~1 s depois de parar de digitar e ao sair da nota; também pelo botão **Salvar** ou `Ctrl+S`. Uma nota nova só é gravada quando tem texto; apagar todo o texto de uma nota existente não a exclui (ela volta ao último conteúdo salvo). Limite de 10.000 caracteres.
- Layout de **caderno aberto**: tarefas na página esquerda, notas na direita, cada página com rolagem própria.
- Tema escuro fixo, no conceito "caderno à noite" aberto sobre uma mesa: linhas pautadas, margem coral e um marca-texto amarelo como único destaque. O traço sob a data mostra o progresso do dia, e concluir uma tarefa a risca com o marca-texto.
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
src-tauri/src/db.rs          # schema SQLite (tarefas, subtarefas, notas), operações e testes
src-tauri/src/lib.rs         # comandos Tauri expostos ao frontend
src/api.ts                   # wrappers tipados de invoke()
src/App.tsx                  # moldura do caderno aberto e aviso de erro
src/TodoPage.tsx             # página de tarefas: lista, drag-and-drop, exclusão
src/NotesPage.tsx            # página de notas: lista, nova nota, exclusão
src/components/NoteItem.tsx  # uma nota: texto, salvar, excluir
src/hooks/useAutosave.ts     # salvamento automático com debounce
src/hooks/useFlip.ts         # animação FLIP (entrada, reordenação, saída)
src/components/              # DayHeader, NotesHeader, TaskItem, Checkbox, InlineEdit, ConfirmDialog, Icons
```

O banco fica em `%APPDATA%\com.todoapp\todo.db`. Para usar outro arquivo (por exemplo, um banco descartável para testes), defina `TODO_APP_DB`:

```powershell
$env:TODO_APP_DB = "C:\temp\teste.db"; npm run tauri dev
```
