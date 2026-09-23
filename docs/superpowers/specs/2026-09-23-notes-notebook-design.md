# Notas + layout de caderno aberto — design

Data: 2026-09-23
Status: aprovado em conversa, aguardando revisão desta especificação

## Objetivo

Adicionar uma seção de **notas** ao Todo App e reorganizar a interface como um
**caderno aberto**: página esquerda com as tarefas (como hoje), página direita
com as notas.

## O que o usuário pediu

- Uma página de anotações ao lado das tarefas.
- Notas só têm as opções de **criar** e **excluir** (sem concluir, subtarefas ou
  reordenação).
- No texto da nota, **Enter pula linha** (não salva).
- Salvamento **automático** ou pelo **botão Salvar**.
- A aplicação deve parecer um **caderno aberto**.

## Decisões tomadas na conversa

- Notas continuam **editáveis** depois de criadas (opção A).
- As duas páginas ficam **sempre lado a lado** (opção A): janela padrão
  ~1280×820, largura mínima 900 px. Sem empilhamento nem abas.

## Comportamento das notas

- Pilha de notas, **mais nova no topo**. Cada nota é só um corpo de texto livre
  (sem título).
- **Criar:** botão "+ Nova nota" no topo da página abre uma nota em branco com o
  cursor nela. A nota só é gravada no banco quando recebe algum texto
  (não-vazio após `trim`). Se perder o foco ainda vazia, some da tela.
- **Editar:** Enter insere quebra de linha. Salvamento:
  - automático ~1 s após parar de digitar (debounce) e ao sair da nota (blur);
  - manual pelo botão **Salvar** (visível apenas com mudanças não salvas) ou
    **Ctrl+S** com o foco na nota.
  - indicador discreto: "Salvando…" → "Salvo".
- **Apagar todo o texto** de uma nota existente não a exclui: o conteúdo vazio não
  é enviado ao banco e a nota mantém o último conteúdo salvo. Excluir é só pela
  lixeira.
- **Excluir:** ícone de lixeira → `ConfirmDialog` (o mesmo das tarefas).
  Exclusão física, sem desfazer.
- Limite de **10.000 caracteres** por nota (`maxLength` no campo e validação no
  backend).
- O texto é salvo como digitado (quebras de linha preservadas). O `trim` serve só
  para decidir se a nota está vazia.
- Limitação conhecida e aceita: fechar o app menos de ~1 s depois de digitar pode
  perder as últimas letras. Não vamos salvar ao fechar a janela nesta versão.

## Dados e backend (Rust)

Tabela nova em `db.rs` (dentro de `SCHEMA`, `CREATE TABLE IF NOT EXISTS`, então
bancos existentes ganham a tabela ao abrir):

```sql
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
```

Struct `Note { id, body, created_at, updated_at }` (serializável; datas em UTC,
formato `YYYY-MM-DD HH:MM:SS.SSS`, convertidas para hora local no frontend).

Funções em `db.rs`, seguindo o padrão atual (queries parametrizadas, `DbError`):

- `list_notes(conn) -> Vec<Note>` — `ORDER BY created_at DESC, id DESC`.
- `create_note(conn, body) -> Note` — recusa corpo vazio (`EmptyBody`) ou acima
  de 10.000 caracteres (`BodyTooLong`); retorna a nota criada (o frontend precisa
  do `id` e do `created_at`).
- `update_note(conn, id, body) -> Note` — mesmas validações; atualiza
  `updated_at`; `NotFound` se o id não existe.
- `delete_note(conn, id)` — `NotFound` se o id não existe.

Novas variantes de `DbError` com mensagens em português: `EmptyBody`
("A nota não pode ficar vazia."), `BodyTooLong` ("A nota passou do limite de
10.000 caracteres.").

Comandos Tauri em `lib.rs`: `list_notes`, `create_note`, `update_note`,
`delete_note`, registrados no `generate_handler!`. Nenhuma permissão nova é
necessária (`core:default` cobre comandos da própria aplicação).

## Frontend

### Organização

| Arquivo | Responsabilidade |
|---|---|
| `src/App.tsx` | Moldura do caderno (mesa, duas páginas, lombada) e o toast de erro compartilhado. |
| `src/TodoPage.tsx` | Toda a lógica atual de tarefas, movida de `App.tsx` sem mudar comportamento. Recebe `onError`. |
| `src/NotesPage.tsx` | Carrega/lista notas, "+ Nova nota", diálogo de exclusão. Recebe `onError`. |
| `src/components/NoteItem.tsx` | Uma nota: textarea que cresce, data/hora, estado de salvamento, Salvar, lixeira. |
| `src/components/NotesHeader.tsx` | Título "Notas", traço de marca-texto decorativo, contagem. |
| `src/hooks/useAutosave.ts` | Debounce de ~1 s, `flush()` para blur/Salvar/Ctrl+S, estado `idle | dirty | saving | saved`. |
| `src/api.ts` | Tipo `Note` e wrappers `listNotes`, `createNote`, `updateNote`, `deleteNote`. |

### Fluxo de uma nota nova

1. "+ Nova nota" adiciona ao topo um item local sem `id` (rascunho), com foco.
2. No primeiro salvamento com texto não-vazio: `createNote(body)` → o item passa a
   ter `id`; salvamentos seguintes usam `updateNote`.
3. Blur com texto vazio e sem `id` → o rascunho é descartado.
4. Só pode existir um rascunho sem `id` por vez; clicar "+ Nova nota" de novo
   apenas foca o rascunho existente.

### Autosave

- Cada tecla marca `dirty` e reinicia um timer de 1 s; ao expirar, salva.
- `flush()` (blur, Salvar, Ctrl+S) cancela o timer e salva imediatamente se `dirty`.
- Um salvamento por vez por nota: se houver mudanças durante um salvamento, outro
  é agendado ao terminar (sem requisições concorrentes).
- Falha ao salvar: o estado volta a `dirty` (botão Salvar visível) e a mensagem
  vai para o toast de erro.
- Ao desmontar, o hook salva mudanças pendentes; a exceção é a nota que está
  sendo excluída, cujas mudanças pendentes são descartadas.

## Visual: caderno aberto

- **Mesa:** fundo da janela mais escuro que as páginas.
- **Caderno:** centralizado, largura máxima ~1320 px, altura da janela menos uma
  margem; duas páginas iguais em `grid` de duas colunas.
- **Lombada:** faixa central estreita e escura; sombra suave nas duas páginas
  perto dela (curvatura do papel).
- **Espessura:** cantos externos levemente arredondados; `box-shadow` em camadas
  sob o caderno sugerindo a pilha de folhas.
- As duas páginas usam o estilo "caderno à noite" existente (pauta, margem coral,
  marca-texto amarelo). Cada página **rola de forma independente**.
- **Página de notas:**
  - cabeçalho "Notas" na mesma tipografia da data, com traço de marca-texto
    estático e a contagem ("1 nota", "3 notas");
  - "+ Nova nota" com o estilo da linha de nova tarefa;
  - cada nota: textarea sem borda sobre papel pautado, `line-height` alinhado às
    linhas da pauta, altura cresce com o conteúdo (sem scroll interno);
  - acima da nota, em cinza: data/hora de criação ("23 set, 14:32") e o estado
    de salvamento; à direita, Salvar (quando `dirty`) e lixeira — visíveis ao
    passar o mouse ou com foco, como `.row-actions` nas tarefas;
  - sem notas: frase curta no tom de "Página em branco…".
- `DayHeader`: o `clamp()` do título hoje usa `vw`; ajustar para a largura de
  uma página.
- Animações novas (entrada/saída de nota) respeitam `prefers-reduced-motion`.
- `tauri.conf.json`: `width` 1280, `height` 820, `minWidth` 900, `minHeight` 560.

## Testes e verificação

- `cargo test` — novos testes em `db.rs`:
  - cria e lista notas, mais nova primeiro;
  - preserva quebras de linha no corpo;
  - recusa corpo vazio/só espaços e acima do limite (criar e editar);
  - `update_note` altera corpo e `updated_at`;
  - `delete_note` remove; ids inexistentes retornam `NotFound`.
- `npm run build` (typecheck + build).
- Verificação no app real via WebView2 CDP com um `TODO_APP_DB` descartável:
  capturas do caderno aberto; criar nota, Enter gera nova linha, autosave após
  pausa, Salvar/Ctrl+S, rascunho vazio some, excluir com confirmação, tarefas
  continuam funcionando como antes.

## Fora do escopo

- Título separado, busca, reordenação, formatação (markdown) de notas.
- Salvar ao fechar a janela.
- Layout responsivo abaixo de 900 px.
- Tema claro.
