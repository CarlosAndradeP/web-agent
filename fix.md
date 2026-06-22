# Bugs Conhecidos — Corrigidos

## Críticos

### BUG-1: Sistema de créditos nunca deduz saldo

**Sintoma:** Após qualquer interação com o agente, o saldo de créditos do usuário permanecia inalterado. A barra de progresso e o contador no sidebar não atualizavam.

**Causa-raiz:** `src/db/repositories/tasks.ts:49-63` — O método `mapRow()` do `TasksRepository` não mapeava as colunas `user_id` e `workspace_dir` do banco para as propriedades `userId` e `workspaceDir` do objeto `Task`. Como resultado, em `src/services/task-manager.ts:77,158`, o acesso `(task as any).user_id` sempre retornava `undefined`, e a guarda `if (userId && toolResults?.length)` no callback `onStepFinish` nunca era satisfeita. A dedução de créditos jamais executava.

**Correção:**
- Adicionados `userId: row.user_id ?? undefined` e `workspaceDir: row.workspace_dir ?? undefined` no `mapRow()`
- Substituído `(task as any).user_id` por `task.userId` e `(task as any).workspace_dir` por `task.workspaceDir` em ambos os métodos (`runTask` e `streamTask`) do `TaskManager`

**Arquivos alterados:**
- `src/db/repositories/tasks.ts`
- `src/services/task-manager.ts`

---

### BUG-2: Agente escreve arquivos no workspace global (invisíveis no FileManager)

**Sintoma:** Arquivos criados pelo agente via chat não apareciam no FileManager, mesmo existindo no disco.

**Causa-raiz:** Mesmo BUG-1. Como `workspaceDir` não era mapeado no `mapRow()`, o `TaskManager` usava o fallback `appConfig.workspaceDir` (global, `./workspace/`). O FileManager API resolve o workspace per-user como `./workspace/<username>/`. O agente escrevia em `./workspace/file.txt` enquanto o FileManager listava `./workspace/admin/` — diretórios diferentes.

**Correção:** Correção do BUG-1 resolve este bug. Após o fix, o `workspaceDir` da task aponta para `./workspace/<username>/`, igual ao FileManager.

**Arquivos alterados:** Mesmos do BUG-1.

---

### BUG-3: Links de projetos publicados (`/p/<uuid>/`) retornam página React ao invés de 404

**Sintoma:** Ao acessar um projeto publicado sem `index.html`, em vez de um 404 claro, o navegador exibia a SPA do React (página em branco ou redirect para login).

**Causa-raiz:** Em `src/services/project-router.ts:25-44`, o middleware `projectRouter.middleware()` chamava `next()` quando o `express.static()` interno não encontrava o arquivo. Isso fazia a requisição subir para os middlewares seguintes do Express, onde o catch-all SPA (`app.get('{*path}', ...)`) interceptava e retornava `index.html` do frontend.

**Correção:** Para projetos do tipo `static`, o `next()` do handler interno agora retorna 404 em vez de delegar ao próximo middleware. Projetos PHP e Node continuam usando `next()` pois estão por trás de um proxy.

**Arquivos alterados:**
- `src/services/project-router.ts`

---

### BUG-4: Rotas admin acessíveis por qualquer usuário autenticado

**Sintoma:** Qualquer usuário com role `user` conseguia acessar `/api/admin/users`, visualizar todos os usuários, modificar créditos, roles e deletar contas.

**Causa-raiz:** Em `src/server.ts:107`, a rota admin era montada com apenas `authMiddleware`, sem o `adminMiddleware`. O middleware `adminMiddleware` existia em `src/middleware/admin.ts` mas nunca era importado/aplicado.

**Correção:** Importação de `adminMiddleware` e adição na cadeia de middlewares: `app.use('/api/admin', authMiddleware, adminMiddleware, createAdminRouter(...))`.

**Arquivos alterados:**
- `src/server.ts`

---

### BUG-5: Projetos com falha de mount no startup permanecem como "active" no banco

**Sintoma:** Após restart do servidor, projetos cuja pasta não existia mais ou tinha outro problema geravam erro no mount mas continuavam com `status='active'` no banco. A URL `/p/<uuid>/` retornava 404 mesmo com o projeto listado como ativo.

**Causa-raiz:** Em `src/server.ts:140-151`, o bloco `catch` do remount apenas logava o aviso, sem atualizar o status do projeto no banco.

**Correção:** No `catch`, adicionada chamada `projectsRepo.updateStatus(p.id, 'error')` para marcar projetos com falha de mount.

**Arquivos alterados:**
- `src/server.ts`

---

## Médios

### BUG-6: Registros duplicados na tabela `agent_steps`

**Sintoma:** Cada step do agente era inserido duas vezes na tabela `agent_steps`.

**Causa-raiz:** Em `src/services/task-manager.ts`, o callback `onStepFinish` inseria um registro para cada tool result, E o gerador `eventStream()` também inseria no chunk `tool-result`. Cada step era gravado em duplicata.

**Correção:** Removida a inserção do `onStepFinish` em ambos os métodos (`runTask` e `streamTask`). A inserção de steps ficou centralizada no `eventStream()`, que já calcula a duração (`durationMs`) corretamente.

**Arquivos alterados:**
- `src/services/task-manager.ts`

---

### BUG-7: Créditos de usuários broadcastados para todos via Socket.IO

**Sintoma:** Quando o agente executava um step para o usuário A, o evento `credits:deducted` era emitido via `io.emit()` para TODOS os clientes conectados, incluindo o usuário B. Isso�azia privacidade e causava ruído no frontend de outros usuários.

**Causa-raiz:** Em `src/services/credit-manager.ts`, os eventos Socket.IO usavam `this.io.emit()` (broadcast global) ao invés de `this.io.to(room).emit()`.

**Correção:**
- Substituído `this.io.emit(...)` por `this.io.to(\`user:\${userId}\`).emit(...)` para eventos `credits:deducted` e `credits:exhausted`
- Adicionado evento `user:join` no WebSocket (`src/websocket/events.ts`) para que clientes entrem na room própria
- Frontend (`AuthContext.tsx`) emite `user:join` ao conectar com o userId

**Arquivos alterados:**
- `src/services/credit-manager.ts`
- `src/websocket/events.ts`
- `frontend/src/contexts/AuthContext.tsx`

---

### BUG-8: Cache de créditos no localStorage não atualizava em tempo real

**Sintoma:** Ao recarregar a página, o saldo de créditos exibia um valor stale (do momento do login), mesmo que o saldo real tivesse mudado via WebSocket. A correção só acontecia após 14 minutos (próximo refresh token).

**Causa-raiz:** Em `frontend/src/contexts/AuthContext.tsx`, a função `updateCredits()` atualizava o state React mas não sincronizava o `localStorage`.

**Correção:** `updateCredits()` agora escreve o usuário atualizado no `localStorage.setItem(USER_KEY, ...)`.

**Arquivos alterados:**
- `frontend/src/contexts/AuthContext.tsx`

---

## Funcionalidades Adicionadas (corrigem problemas de design)

### FEAT-1: Agente trabalha dentro da pasta do projeto (não na raiz do workspace)

**Problema anterior:** O `workspaceDir` passado ao agente era sempre a raiz do workspace do usuário (`./workspace/<username>/`). Arquivos criados pelo agente ficavam misturados na raiz, sem organização por projeto.

**Correção:** Em `src/api/chat.ts`, quando a sessão do chat está vinculada a um projeto, o `workspaceDir` é resolvido para `./workspace/<username>/<folderPath>/`. O agente agora opera no escopo do projeto.

**Arquivos alterados:**
- `src/api/chat.ts`

---

### FEAT-2: FileManager escopado ao projeto ativo

**Problema anterior:** O `FileManager` listava todos os arquivos da raiz do workspace (`.`), sem filtro por projeto. Arquivos de diferentes projetos ficavam misturados na árvore.

**Correção:** O hook `useFiles(basePath)` agora aceita um caminho base. O `FileManager` recebe `basePath` como prop. O `Layout` passa `activeProject?.folderPath` como basePath.

**Arquivos alterados:**
- `frontend/src/hooks/useFiles.ts`
- `frontend/src/components/FileManager.tsx`
- `frontend/src/components/Layout.tsx`

---

### FEAT-3: Painel admin com gerenciamento de modelos e custo variável por step

**Problema anterior:** O admin não podia controlar quais modelos estavam disponíveis para usuários, nem definir custos diferentes por modelo. O custo por step era fixo em 1 crédito.

**Correção:**
- Nova tabela `model_config` no schema SQLite (`src/db/schema.ts`)
- Novo repository `ModelConfigRepository` (`src/db/repositories/model-config.ts`)
- 3 novos endpoints admin: `GET /admin/models`, `PUT /admin/models/:modelId`, `DELETE /admin/models/:modelId`
- `CreditManager.deductCredit()` agora aceita `costPerStep` como parâmetro
- `TaskManager` consulta `creditManager.getCostPerStep(model)` antes de deduzir
- `GET /api/models` (público) filtra modelos desabilitados e inclui `costPerStep`
- Frontend `AdminPanel` reescrito com aba Models (toggle enable/disable, editar custo/display name)
- Frontend `ChatPanel` exibe custo por step no seletor de modelo
- Dashboard admin expandido com 9 stat cards + top users

**Arquivos alterados/criados:**
- `src/db/schema.ts` (nova tabela)
- `src/db/repositories/model-config.ts` (novo)
- `src/services/credit-manager.ts`
- `src/services/task-manager.ts`
- `src/api/admin.ts`
- `src/api/models.ts`
- `src/server.ts`
- `frontend/src/types/index.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/components/AdminPanel.tsx`
- `frontend/src/components/ChatPanel.tsx`
