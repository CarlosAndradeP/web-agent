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

### BUG-9: Créditos não atualizam em tempo real — `creditManager.setIo()` nunca chamado

**Sintoma:** O saldo de créditos do usuário só atualizava ao relogar (login) ou a cada 14 minutos (refresh token). Eventos Socket.IO `credits:deducted` e `credits:exhausted` nunca chegavam ao frontend.

**Causa-raiz:** Em `src/websocket/index.ts`, a função `setupWebSocket()` injetava a instância do Socket.IO (`io`) no `approvalManager.setIo(io)` e `taskManager.setIo(io)`, mas **esquecia** de chamar `creditManager.setIo(io)`. Como resultado, `this.io` no `CreditManager` era sempre `null` e os eventos `io.to('user:${userId}').emit('credits:deducted', ...)` nunca eram emitidos.

**Correção:**
- `src/websocket/index.ts`: Adicionado parâmetro `creditManager: CreditManager` e chamada `creditManager.setIo(io)`
- `src/server.ts`: Passa `creditManager` para `setupWebSocket(io, approvalManager, taskManager, creditManager)`
- `frontend/src/contexts/AuthContext.tsx`: Re-emite `user:join` no evento `socket.on('connect')` para garantir room membership após reconexões

**Arquivos alterados:**
- `src/websocket/index.ts`
- `src/server.ts`
- `frontend/src/contexts/AuthContext.tsx`

---

### BUG-10: Links externos de projetos publicados não funcionam (PHP, Node.js e Static)

**Sintoma:** Ao acessar `/p/<uuid>/`, projetos PHP retornavam 404, projetos Node.js perdiam o prefixo UUID no proxy, e projetos estáticos perdiam query strings.

**Causa-raiz (múltiplas):**

1. **PHP: target do proxy inacessível** — O proxy PHP apontava para `http://localhost:8080/<uuid>/`, mas o Apache tem `DocumentRoot /app/workspace`. Não existe diretório `/app/workspace/<uuid>/` — os arquivos estão em `/app/workspace/<username>/<folderPath>/`. Sem `Alias` ou `ProxyPass` no Apache que mapeasse UUID → caminho real, todo request PHP resultava em 404.

2. **pathRewrite era código morto** — A linha 41 do `project-router.ts` reescrevia `req.url` removendo o UUID ANTES do proxy executar. Os `pathRewrite` nos proxies PHP e Node.js tentavam match em `^/<uuid>` em URLs que já não continham UUID, logo nunca disparavam.

3. **Query strings eram descartadas** — O regex `(?:\?.*)?$` descartava query strings, e a reescrita de `req.url` na linha 41 não as preservava. Requests como `/p/<uuid>/page.php?foo=bar` perdiam `?foo=bar`.

**Correção:**

- **Symlink para PHP**: Ao montar projeto PHP, cria symlink `<workspaceBaseDir>/<uuid>` → `<username>/<folderPath>/`. O Apache resolve o symlink sob `DocumentRoot /app/workspace`. Ao desmontar, o symlink é removido. O target do proxy permanece `http://localhost:8080/<uuid>/` — agora funcional pois o symlink existe no filesystem.

- **pathRewrite removido**: Os `pathRewrite` mortos foram removidos dos proxies PHP e Node.js. O middleware do ProjectRouter continua removendo o prefixo UUID de `req.url` antes de delegar ao proxy (necessário para que `express.static` e os proxys recebam apenas o sub-path).

- **Query strings preservadas**: `req.url` agora inclui a query string após a reescrita: `req.url = subPath + queryString`.

- **Limpeza de symlinks**: `unmountProject()` e `shutdownAll()` removem symlinks automaticamente. No startup, `mountProject()` recria symlinks para projetos PHP com status `active`.

**Arquivos alterados:**
- `src/services/project-router.ts`

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

---

### FEAT-4: FileManager com navegação estilo explorer, download ZIP e extração de ZIP

**Problema anterior:** O FileManager era uma árvore plana com expand/collapse, sem navegação entre pastas, sem breadcrumbs, sem botão voltar. Download era apenas de arquivos individuais. Upload só funcionava para texto (binary corrompia). Não existia extração de ZIP.

**Correção:**

**Backend (`src/api/files.ts`):**
- `GET /files/download-zip?path=X` — Compacta pasta como ZIP via `archiver` (streaming com zlib level 6)
- `POST /files/extract-zip` — Recebe ZIP via multer memória e extrai com `adm-zip` no destino
- `GET /files/list-folders?path=X` — Lista apenas subpastas (para o dropdown de "Novo Projeto")

**Frontend (`FileManager.tsx`):**
- **Breadcrumbs** clicáveis no topo (root > folder > subfolder) — navegação direta para qualquer nível
- **Botão voltar** (ArrowLeft) — navega ao diretório acima
- **Duplo-clique em pasta** — navega dentro dela (muda `currentPath`, atualiza tree)
- **Download ZIP** (ícone Archive) — botão hover em cada pasta no tree
- **Extrair ZIP** (ícone PackageOpen) — botão no header + input file oculto
- **Upload binário corrigido** — Usa multipart/form-data via `POST /files/upload` em vez de `readAsText` + PUT
- **Drag & drop aprimorado** — Aceita arquivos e .zip simultaneamente; .zip é extraído, outros são uploaded

**Novas dependências backend:** `archiver`, `adm-zip`, `@types/archiver`, `@types/adm-zip`

**Arquivos alterados/criados:**
- `src/api/files.ts` (3 novos endpoints + imports)
- `frontend/src/components/FileManager.tsx` (reescrito)
- `frontend/src/hooks/useFiles.ts` (error handling)
- `frontend/src/lib/api.ts` (3 novos métodos: `downloadZipUrl`, `extractZip`, `listFolders`)
- `package.json` (4 novas dependências)

---

### FEAT-5: Novo Projeto — escolher pasta existente no workspace

**Problema anterior:** Ao criar um novo projeto, o `folderPath` era gerado automaticamente via slug do nome (ex: "My App" → "my-app"). Não era possível usar uma pasta já existente no workspace, impossibilitando importar projetos existentes.

**Correção:**

**Backend:** Novo endpoint `GET /files/list-folders?path=X` (já documentado em FEAT-4) que lista subpastas do workspace.

**Frontend (`Layout.tsx`):** O dialog "Novo Projeto" agora inclui:
- Checkbox "Usar pasta existente no workspace"
- Dropdown de pastas existentes (populado via `api.files.listFolders('.')`)
- Campo de nome da pasta editável (auto-gerado do nome do projeto se não usar existente)
- Se marcar "usar existente", seleciona do dropdown; se não, o backend cria a pasta automaticamente

**Arquivos alterados:**
- `frontend/src/components/Layout.tsx`
- `frontend/src/lib/api.ts` (`listFolders`)

---

### FEAT-6: Painel de usuário para não-admins (conta, segurança, créditos)

**Problema anterior:** Usuários não-admin não tinham nenhum painel de conta. Não podiam trocar senha, ver histórico de créditos ou atualizar email. O histórico de créditos só era acessível via rota admin (`/api/admin/users/:id/credits/history`).

**Correção:**

**Backend:**
- `UsersRepository.updatePassword(id, newPassword)` — Hash bcrypt da nova senha e update no DB
- `UsersRepository.updateEmail(id, email)` — Atualiza email do usuário
- `POST /api/auth/change-password` — Verifica senha atual (bcrypt compare), atualiza se correta. Requer auth.
- `GET /api/auth/credits/history` — Retorna histórico de créditos do próprio usuário (não precisa ser admin). Requer auth.
- `PATCH /api/auth/profile` — Atualiza email do próprio usuário. Requer auth.

**Frontend:**
- **`UserPanel.tsx`** — Novo componente com 3 tabs:
  - **Conta**: username (read-only), email (editável com Save), role (read-only), data de criação
  - **Segurança**: form trocar senha (senha atual + nova + confirmação), validação client-side
  - **Créditos**: saldo atual com card destacado, histórico de transações (amount, type, description, date, balanceAfter)
- **Layout.tsx**: Admins veem tab "Admin" (AdminPanel), não-admins veem tab "Account" (UserPanel). Mesma posição no layout.
- **Sidebar.tsx**: Tab condicional — `Shield` icon + "Admin" para admins, `User` icon + "Account" para não-admins
- **AuthContext.tsx**: Nova função `updateUser(updates)` para sincronizar mudanças de perfil no state e localStorage
- **auth-api.ts**: 3 novos métodos: `changePassword()`, `creditHistory()`, `updateProfile()`

**Arquivos alterados/criados:**
- `src/db/repositories/users.ts` (2 novos métodos)
- `src/api/auth.ts` (3 novos endpoints)
- `frontend/src/components/UserPanel.tsx` (novo)
- `frontend/src/components/Layout.tsx` (tab condicional admin/account)
- `frontend/src/components/Sidebar.tsx` (tab condicional + ícone User)
- `frontend/src/contexts/AuthContext.tsx` (novo `updateUser()`)
- `frontend/src/lib/auth-api.ts` (3 novos métodos + tipo `CreditTransaction`)

---

### FEAT-7: Re-join de room Socket.IO após reconexão

**Problema anterior:** Se a conexão Socket.IO caísse e reconectasse, o cliente não re-enviava o evento `user:join`, ficando fora da room `user:${userId}`. Eventos de créditos emitidos após a reconexão não chegavam ao cliente.

**Correção:** Em `AuthContext.tsx`, o listener `socket.on('connect', joinRoom)` re-emite `user:join` a cada reconexão. Se o socket já estava conectado no momento do setup, `joinRoom()` é chamado imediatamente.

**Arquivos alterados:**
- `frontend/src/contexts/AuthContext.tsx`

---

## Iteração 3 — Novas Funcionalidades

### FEAT-8: Node.js projects start stopped

**Problema anterior:** Projetos Node.js eram automaticamente montados e spawnados na criação. Se o `index.js` não existisse, o `spawnAndWatch()` fazia 5 retries silenciosos (1s cada) antes de falhar. O projeto ficava com status inconsistente.

**Correção:**
- Projetos Node.js são criados com `status='stopped'` e não chamam `mountProject()` na criação
- `spawnNodeProject()` verifica se o entrypoint (`index.js`, `package.json.main`, ou `npm start`) existe antes de spawnar o processo
- `spawnAndWatch()` propaga erros de spawn ao invés de crash silencioso
- `mountProject()` e `startProject()` fazem cleanup (removem do `activeProjects` Map) se o spawn falhar
- Mensagem de erro clara: `"Node.js entry point not found: index.js. Create the file first, then start the project."`

**Arquivos alterados:**
- `src/db/repositories/projects.ts` — `create()` aceita `status` param
- `src/api/projects.ts` — Node projects criados com `status='stopped'`, skip `mountProject()`
- `src/services/project-router.ts` — entrypoint check, error propagation, cleanup on spawn failure

---

### FEAT-9: Pause registration toggle

**Problema anterior:** Não existia forma de impedir novos registros. Qualquer pessoa podia criar contas sem controle.

**Correção:**
- Chave `registration_enabled` na tabela `config` (default: `'true'`)
- `POST /api/auth/register` verifica config antes de permitir registro; retorna 403 se desabilitado
- Novos endpoints admin: `GET /admin/settings` e `PATCH /admin/settings`
- AdminPanel: nova aba Settings com toggle visual (verde=enabled, vermelho=disabled)
- LoginPage: oculta botão Register quando desabilitado; exibe erro amigável se tentar registrar via API

**Arquivos alterados:**
- `src/db/repositories/config.ts`
- `src/api/auth.ts`
- `src/api/admin.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/components/AdminPanel.tsx`
- `frontend/src/components/LoginPage.tsx`

---

### FEAT-10: Agent knows project URL

**Problema anterior:** O agente não tinha conhecimento do projeto em que trabalhava. Não sabia a URL pública, o tipo do projeto, nem que projetos Node.js precisam ser iniciados manualmente.

**Correção:**
- `buildSystemPrompt()` injeta dinamicamente PROJECT CONTEXT no system prompt
- `ProjectInfo` (uuid, name, type, publicUrl) passado de chat.ts → taskManager → createAgent
- `PUBLIC_BASE_URL` env var definida no docker-compose.yml para construir URLs públicas
- Dicas por tipo de projeto (Node: "start stopped", PHP: "immediate reflection", Static: "served directly")

**Arquivos alterados:**
- `src/config.ts` — `publicBaseUrl`
- `src/agent/index.ts` — `ProjectInfo` interface, `projectInfo` param
- `src/agent/instructions.ts` — `buildSystemPrompt()`, `SUB_AGENT_SYSTEM_PROMPT`
- `src/api/chat.ts` — resolve project info, passa ao taskManager
- `src/services/task-manager.ts` — `taskProjectInfo` Map, passa a `createAgent()`
- `docker-compose.yml` — `PUBLIC_BASE_URL`

---

### FEAT-11: Persistence hardening

**Problema anterior:** Ao reconstruir o container Docker, o `.env` era perdido (não estava em volume). Se o SQLite corrompesse, o servidor crashava sem recuperação. Não havia backup automático do banco.

**Correção:**
- `initDatabase()` executa `PRAGMA integrity_check` antes de abrir o DB; se falhar, faz backup do corrompido e recria
- `docker-compose.yml` monta `.env` como volume read-only
- `docker-start.sh` faz backup do DB antes de iniciar (rotação de 5 backups em `/app/data/backups/`)

**Arquivos alterados:**
- `src/db/index.ts`
- `docker-compose.yml`
- `docker-start.sh`

---

### FEAT-12: Better agent display

**Problema anterior:** A UI do chat mostrava apenas "Agent thinking..." e ícones genéricos (Wrench) para todas as ferramentas. Não havia indicação visual do que o agente estava fazendo em cada momento.

**Correção:**
- `useChat` rastreia `currentToolName` via SSE events
- `StepProgressBar` mostra descrição contextual (ex: "Running command...", "Writing file...") + estado "Done" quando completo
- `TypingIndicator` mostra mensagem por ferramenta com cores (amber=command, blue=write, purple=install, indigo=sub-agent)
- `ToolCallDisplay` usa ícones lucide-react específicos por ferramenta (Pencil, Terminal, Search, Globe, etc.) + cores dedicadas

**Arquivos alterados:**
- `frontend/src/hooks/useChat.ts`
- `frontend/src/components/StepProgressBar.tsx`
- `frontend/src/components/TypingIndicator.tsx`
- `frontend/src/components/ToolCallDisplay.tsx`
- `frontend/src/components/ChatPanel.tsx`

---

### FEAT-13: Sub-agents

**Problema anterior:** O agente não podia delegar sub-tarefas. Toda tarefa, mesmo paralelizável ou decomponível, era executada sequencialmente pelo agente principal.

**Correção:**
- Nova ferramenta `invokeSubAgent` (`src/agent/tools/sub-agent.ts`)
- Sub-agente usa `ToolLoopAgent` com 5 ferramentas (writeFile, readFile, listFiles, searchFiles, runCommand)
- System prompt dedicado (`SUB_AGENT_SYSTEM_PROMPT`) — focado em eficiência
- maxSteps configurável (default 15, cap 30)
- Registrado condicionalmente (requer apiBaseUrl + apiKey)
- Frontend: ícone Users + cor indigo para sub-agent em ToolCallDisplay, TypingIndicator, StepProgressBar

**Arquivos alterados/criados:**
- `src/agent/tools/sub-agent.ts` (novo)
- `src/agent/tools/index.ts`
- `src/agent/index.ts`
- `src/agent/instructions.ts`
- `frontend/src/components/ToolCallDisplay.tsx`
- `frontend/src/components/TypingIndicator.tsx`
- `frontend/src/components/StepProgressBar.tsx`
