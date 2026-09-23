# Pendências

Problemas menores encontrados na revisão final da página de notas (2026-09-23).
Nenhum perde dados em uso normal; ficaram para uma correção futura.

## Notas

### 1. Nota fantasma ao apagar um rascunho enquanto ele está sendo criado

- **Onde:** `src/components/NoteItem.tsx` (`leave`) e `src/NotesPage.tsx` (`remove`).
- **Cenário:** digitar em uma nota nova, esperar o salvamento automático começar
  (`createNote` em andamento), apagar todo o texto e clicar fora antes da criação
  terminar. A nota some da tela, mas fica gravada no banco e reaparece ao reabrir o app.
- **Probabilidade:** muito baixa (a janela é de uma chamada local ao banco).
- **Correção sugerida:** em `leave`, se o rascunho estiver salvando, esperar a criação
  terminar e então tratar como nota existente (voltar ao último texto salvo).

### 2. "+ Nova nota" pode voltar ao rascunho recém-escrito

- **Onde:** `src/NotesPage.tsx` (`addNote`).
- **Cenário:** escrever numa nota nova e clicar em "+ Nova nota" em menos de ~1 s. Se a
  criação ainda não terminou, o cursor volta para essa nota em vez de abrir outra.
- **Correção sugerida:** não tratar como rascunho uma nota nova que já tem texto, ou
  fazer o `NoteItem` avisar o `NotesPage` quando está criando.

### 3. Aviso de erro não some após salvar com sucesso

- **Onde:** `src/NotesPage.tsx` (prop `onError`) e `src/hooks/useAutosave.ts`.
- **Cenário:** um salvamento falha e o aviso aparece; o usuário clica em Salvar, dá certo
  ("Salvo"), mas o aviso de erro continua na tela até ser fechado.
- **Correção sugerida:** limpar o erro (`setError(null)`) no primeiro salvamento bem-sucedido
  depois de uma falha.

### 4. Após uma falha, o botão Salvar fica invisível

- **Onde:** `src/App.css` (`.note-actions { opacity: 0 }`) e `STATUS_LABEL` em `NoteItem.tsx`.
- **Cenário:** o salvamento falha ao sair da nota. O botão Salvar só aparece ao passar o
  mouse ou focar a nota, e o estado "não salvo" não mostra nenhum texto.
- **Correção sugerida:** manter as ações visíveis enquanto houver mudanças não salvas, ou
  mostrar "Não salvo" no indicador.

### 5. Limite de 10.000 caracteres conta emoji como 2 e não avisa

- **Onde:** `src/components/NoteItem.tsx` (`maxLength`).
- **Cenário:** o `maxLength` do navegador conta unidades UTF-16, então uma nota só com
  emoji para em 5.000. Colar um texto que passa do limite corta o excesso sem aviso.
- **Correção sugerida:** mostrar um contador perto do limite, ou validar por caracteres
  no `change()` e avisar quando o texto for cortado.

### 6. Acessibilidade

- **Onde:** `src/components/NoteItem.tsx` e `src/NotesPage.tsx`.
- **Problemas:**
  - Todas as notas têm o rótulo "Nota" e todas as lixeiras "Excluir nota"; num leitor de
    tela não dá para distinguir uma da outra. Sugestão: incluir a data no rótulo
    (ex.: "Nota de 23 set, 14:32").
  - Depois de excluir uma nota, o foco vai para o corpo da página. Sugestão: mover para a
    próxima nota ou para "+ Nova nota" (as tarefas têm o mesmo comportamento hoje).

## Sugestão geral

- Testes automatizados para `useAutosave` (com timers simulados): salvamentos encadeados,
  falha seguida de nova tentativa e descarte. Hoje a cobertura dessa lógica é só manual,
  pelo app rodando.
