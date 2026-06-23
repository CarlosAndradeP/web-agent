# Web Agent — Plano de Desenvolvimento

## Visão Geral

Plataforma multi-usuário de desenvolvimento web com agente de IA autônomo. Cada usuário tem workspace isolado, créditos, e pode criar projetos com chatvinculado e URL pública.

## Status: IMPLEMENTADO (M1–M12 + F0–F8 + Issues 1–5 + Iteração 3)

### Milestones Completados

| Milestone | Descrição | Status |
|-----------|-----------|--------|
| M1 | Schema + Migration (users, auth_sessions, credit_transactions, projects + ALTER TABLEs) | ✅ |
| M2 | Repositories (users, credits) | ✅ |
| M3 | Auth API (login/register/refresh/me/logout com JWT) | ✅ |
| M4 | Server modifications (bootstrap admin, auth middleware, project router) | ✅ |
| M5 | Per-user workspaces (files.ts resolve por username, path traversal protection) | ✅ |
| M6 | Credit system (CreditManager, deduct per step, abort on exhaustion) | ✅ |
| M7 | Project Router (static/php/node middleware dinâmico) | ✅ |
| M8 | Dockerfile + Apache (php:8.3-apache-bookworm, Composer via installer) | ✅ |
| M9 | Frontend Login + Auth (LoginPage, AuthContext, auto-refresh, 401 interceptor) | ✅ |
| M10 | Frontend Admin Panel (users list, credits, roles, stats) | ✅ |
| M11 | Frontend Project Publishing (PublishProjectDialog, folder/type picker) | ✅ |
| M12 | Verification (tsc --noEmit + vite build pass) | ✅ |
| F0–F8 | UI overhaul (animations, step progress, tool calls display, etc.) | ✅ |

### Issues Resolvidos

| Issue | Descrição | Correção |
|-------|-----------|----------|
| 1 | Workspace admin usada por todos, admin não via raiz | Criar dir no register, startup itera todos users, getWorkspaceDir sem fallback silencioso, 401 se sem auth |
| 2 | Links de projetos não funcionam | Re-mount de projetos no startup via `projectsRepo.listAll()`, file watcher em `workspaceBaseDir` inteiro |
| 3 | Créditos não são consumidos (visualmente) | Socket.IO `credits:deducted`/`credits:exhausted` → `updateCredits()` no AuthContext, mensagem amigável 402 |
| 4 | FileManager sem opções (rename, delete pastas) | Novos endpoints: `/files/rename`, `/files/create-file`; UI: botão rename (lapis), delete pasta com confirmação |
| 5 | Projetos na lateral em vez de chats | Sidebar mostra projetos com badges; cada projeto tem sessão vinculada; dialog "Novo Projeto"; sessões órfãs convertidas |

---

## Iteração 3 — Novas Funcionalidades (Implementado)

### Req 1: Node.js projects start stopped

Projetos Node.js são criados com `status='stopped'` e NÃO são automaticamente montados. O usuário ou agente precisa iniciar manualmente. Verificação de entrypoint antes do spawn.

**Mudanças:**
- `src/db/repositories/projects.ts` — `create()` aceita parâmetro `status` (default `'active'`)
- `src/api/projects.ts` — Node projects criados com `status='stopped'`, skip `mountProject()` na criação
- `src/services/project-router.ts` — `spawnNodeProject()` verifica se entrypoint (`index.js`/`package.json.main`) existe antes de spawnar; `spawnAndWatch()` propaga erros ao invés de crash silencioso; `mountProject()` e `startProject()` tratam erros de spawn

### Req 5: Pause registration toggle

Admin pode pausar novos registros. Quando desabilitado, `POST /api/auth/register` retorna 403 e o botão Register é oculto no login.

**Mudanças:**
- `src/db/repositories/config.ts` — Default `registration_enabled: 'true'`
- `src/api/auth.ts` — Guarda verifica `configRepo.get('registration_enabled')` antes de permitir registro
- `src/api/admin.ts` — Novos endpoints `GET /admin/settings` e `PATCH /admin/settings`
- `frontend/src/lib/api.ts` — Novos métodos `admin.settings()` e `admin.updateSettings()`
- `frontend/src/components/AdminPanel.tsx` — Nova aba Settings com toggle de registro
- `frontend/src/components/LoginPage.tsx` — Oculta botão Register + exibe erro 403 amigável

### Req 2: Agent knows project URL

O agente recebe contexto do projeto (nome, tipo, UUID, URL pública) no system prompt via `PUBLIC_BASE_URL`.

**Mudanças:**
- `src/config.ts` — Novo campo `publicBaseUrl` (env `PUBLIC_BASE_URL`)
- `src/agent/index.ts` — Interface `ProjectInfo`, `createAgent()` aceita `projectInfo`
- `src/agent/instructions.ts` — `buildSystemPrompt()` injeta PROJECT CONTEXT no prompt; `SUB_AGENT_SYSTEM_PROMPT` para sub-agent
- `src/api/chat.ts` — Resolve project info (uuid, name, type, publicUrl) e passa ao taskManager
- `src/services/task-manager.ts` — Map `taskProjectInfo` armazena info por taskId, passa a `createAgent()`
- `docker-compose.yml` — `PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}`

### Req 6: Persistence hardening

Integridade do SQLite verificada no startup; backup automático antes de iniciar; `.env` persistido como volume.

**Mudanças:**
- `src/db/index.ts` — `initDatabase()` faz `PRAGMA integrity_check` antes de abrir DB; se corrompido, faz backup e recria
- `docker-compose.yml` — Volume `./.env:/app/.env:ro` para persistir configuração
- `docker-start.sh` — Backup do DB antes de iniciar (rotaciona 5 backups mais recentes)

### Req 3: Better agent display

UI do chat mostra atividade contextual do agente: nome da ferramenta, ícones específicos, cores por tipo.

**Mudanças:**
- `frontend/src/hooks/useChat.ts` — Novo state `currentToolName`, setado em `tool-call` events
- `frontend/src/components/StepProgressBar.tsx` — Descrição contextual (ex: "Running command..."), estado "Done"
- `frontend/src/components/TypingIndicator.tsx` — Mensagens por ferramenta + cores (amber=command, blue=write, purple=install, indigo=sub-agent)
- `frontend/src/components/ToolCallDisplay.tsx` — Ícones lucide-react por ferramenta (Pencil, Terminal, Search, Globe, etc.) + cores específicas
- `frontend/src/components/ChatPanel.tsx` — Passa `currentToolName` aos componentes

### Req 4: Sub-agents

Nova ferramenta `invokeSubAgent` permite ao agente principal delegar sub-tarefas a um agente filho com 5 ferramentas e maxSteps limitado.

**Mudanças:**
- `src/agent/tools/sub-agent.ts` — Novo tool `invokeSubAgent` (filho: writeFile, readFile, listFiles, searchFiles, runCommand; maxSteps cap 30)
- `src/agent/tools/index.ts` — Registra `invokeSubAgent` quando apiBaseUrl+apiKey disponíveis; `buildToolSet()` aceita `apiBaseUrl`, `apiKey`, `agentType`
- `src/agent/index.ts` — Passa apiBaseUrl/apiKey/agentType a `buildToolSet()`
- `src/agent/instructions.ts` — `SUB_AGENT_SYSTEM_PROMPT`; prompt principal lista `invokeSubAgent`
- Frontend: ToolCallDisplay, TypingIndicator, StepProgressBar — suporte ao ícone `invokeSubAgent` (Users, indigo)

---

## Stack Tecnológica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Agent Framework | Vercel AI SDK v6 | `ai@6.0.208` |
| API Provider | `@ai-sdk/openai-compatible` | `0.2.16` |
| Backend | Express.js v5 + TypeScript 6 | `express@5.2.1` |
| Frontend | React 19 + Vite 8 + TailwindCSS 4 | `vite@8.0.16` |
| Real-time | SSE + Socket.IO | `socket.io@4.8.3` |
| Persistência | SQLite (better-sqlite3, WAL) | `12.11.1` |
| Auth | JWT (bcryptjs + jsonwebtoken) | — |
| Docker Base | php:8.3-apache-bookworm | Debian bookworm |
| Runtime | Node.js 22 + Apache 2 + PHP 8.3 | — |

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker (Port 89)                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Express Server (src/server.ts)                      │   │
│  │                                                      │   │
│  │  /api/auth/*        → Login/Register/Refresh (public) │   │
│  │  /api/admin/*       → Users, credits, stats (admin)  │   │
│  │  /api/chat          → Chat com agente (auth, credit)  │   │
│  │  /api/models        → Modelos disponíveis             │   │
│  │  /api/tasks         → CRUD de tarefas                 │   │
│  │  /api/files         → FileManager per-user             │   │
│  │  /api/config        → Configurações                   │   │
│  │  /api/sessions      → Sessões (filtered by user)      │   │
│  │  /api/projects      → Projetos (auto-creates session)  │   │
│  │  /p/<uuid>/*        → Project Router (public)          │   │
│  │                                                      │   │
│  │  Socket.IO → credits:deducted, file:changed, etc.    │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────┐     │   │
│  │  │  Agent Engine (ai@6.0.208)                  │     │   │
│  │  │  ToolLoopAgent + 9 tools + autocorrective   │     │   │
│  │  │  CreditManager: 1 credit per tool step      │     │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │                                                      │   │
│  │  ┌──────────────┐  ┌──────────────────────────────┐  │   │
│  │  │  SQLite (WAL) │  │  Workspaces                  │  │   │
│  │  │  web-agent.db │  │  /app/workspace/<username>/  │  │   │
│  │  └──────────────┘  └──────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Apache (Port 8080 — internal only)                   │   │
│  │  PHP projects via VirtualHost                        │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## Estrutura de Diretórios

```
web-agent/
├── Dockerfile                    # php:8.3-apache-bookworm multi-stage
├── docker-compose.yml            # Port 89, volumes, env vars
├── docker-start.sh               # Apache2ctl start + node dist/server.js
├── package.json                  # type: module, ESM
├── tsconfig.json                 # ES2022, ESNext, bundler resolution
├── .env.example                  # 13 variáveis com defaults
├── README.md                     # Este arquivo
├── documentation.md              # Documentação técnica completa
├── plano.md                      # Este plano
│
├── apache/
│   ├── ports.conf                # Listen 8080
│   └── projects.conf             # VirtualHost para PHP projects
│
├── src/
│   ├── server.ts                 # Express + Socket.IO + auth bootstrap + project remount
│   ├── config.ts                 # Config centralizado (12+ fields)
│   │
│   ├── agent/
│   │   ├── index.ts             # createAgent() → ToolLoopAgent
│   │   ├── provider.ts           # createProvider() → createOpenAICompatible
│   │   ├── instructions.ts       # AUTOCORRECTIVE_SYSTEM_PROMPT
│   │   └── tools/
│   │       ├── index.ts          # buildToolSet() com approval logic
│   │       ├── write-file.ts     # writeFileSync + mkdirSync
│   │       ├── read-file.ts      # readFileSync
│   │       ├── list-files.ts     # readdirSync + statSync (recursive)
│   │       ├── delete-file.ts    # rmSync recursive
│   │       ├── run-command.ts    # execSync com timeout 30s
│   │       ├── execute-code.ts   # tmp file + execSync (node/tsx/python)
│   │       ├── search-files.ts   # execSync("grep -rn ...")
│   │       ├── web-fetch.ts      # fetch() com AbortSignal.timeout(15s)
│   │       └── install-package.ts # npm install / pip install
│   │
│   ├── api/
│   │   ├── auth.ts              # Login/Register/Refresh/Me/Logout
│   │   ├── admin.ts             # User management, credits, stats
│   │   ├── chat.ts              # POST / → SSE streaming + credit check
│   │   ├── models.ts            # GET / → modelos com cache 5min
│   │   ├── tasks.ts             # CRUD de tarefas
│   │   ├── files.ts             # GET/PUT/DELETE/MKDIR/RENAME/CREATE-FILE/UPLOAD/DOWNLOAD
│   │   ├── config.ts            # GET/PUT configurações
│   │   ├── sessions.ts          # CRUD filtered by userId
│   │   └── projects.ts         # CRUD + auto-create session + mount
│   │
│   ├── db/
│   │   ├── index.ts             # initDatabase() → WAL + FK + schema + migrate
│   │   ├── schema.ts            # 8 tabelas (sessions, messages, tasks, agent_steps, config, users, auth_sessions, credit_transactions, projects)
│   │   ├── migrate.ts            # Idempotent ALTER TABLEs
│   │   └── repositories/
│   │       ├── users.ts          # User CRUD, password hash/verify, toPublic
│   │       ├── credits.ts        # deduct/add/getBalance/getHistory
│   │       ├── projects.ts      # Project CRUD, findByUuid, listAll
│   │       ├── sessions.ts      # Session CRUD
│   │       ├── messages.ts      # create + findBySession
│   │       ├── tasks.ts          # CRUD + updateStatus + incrementStep
│   │       └── config.ts        # Key-value com defaults + UPSERT
│   │
│   ├── middleware/
│   │   ├── auth.ts              # JWT authMiddleware (req.user = { userId, role })
│   │   └── admin.ts             # adminMiddleware (req.user.role === 'admin')
│   │
│   ├── lib/
│   │   └── jwt.ts               # signAccessToken / signRefreshToken / verifyToken
│   │
│   ├── services/
│   │   ├── task-manager.ts      # createTask, streamTask, cancelTask + credit deduction
│   │   ├── credit-manager.ts    # deductCredit, hasCredits, WS events
│   │   ├── project-router.ts    # mount/unmount/shutdownAll (static/php/node)
│   │   ├── approval-manager.ts  # Promise-based approval com timeout 5min
│   │   ├── model-resolver.ts    # Fetch /models com cache 5min
│   │   ├── file-watcher.ts      # Chokidar watcher → socket file:changed
│   │   ├── execution-sandbox.ts # ⚠ Código morto
│   │   └── logger.ts            # Structured logging
│   │
│   ├── websocket/
│   │   ├── index.ts             # setupWebSocket() → injeta IO nos services
│   │   └── events.ts            # session:join, task:subscribe, approval:respond, task:cancel
│   │
│   └── types/
│       └── index.ts             # Todos os tipos compartilhados
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts            # Proxy /api + /socket.io → :89
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # AuthProvider + Login/Layout switch
│   │   ├── index.css
│   │   ├── types/index.ts        # Tipos (Project, UserPublic, etc.)
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx   # Auth state + Socket.IO credits + 401 interceptor
│   │   ├── components/
│   │   │   ├── Layout.tsx       # Sidebar + tabs + project management
│   │   │   ├── Sidebar.tsx      # Projects list with badges
│   │   │   ├── LoginPage.tsx    # Login/Register tabs
│   │   │   ├── ChatPanel.tsx    # SSE streaming + model selector
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallDisplay.tsx
│   │   │   ├── StepProgressBar.tsx
│   │   │   ├── TypingIndicator.tsx
│   │   │   ├── FileManager.tsx  # Tree + rename + delete + create + publish
│   │   │   ├── ConfigPanel.tsx
│   │   │   ├── AdminPanel.tsx   # Users, credits, history, stats
│   │   │   ├── PublishProjectDialog.tsx
│   │   │   ├── ApprovalDialog.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── TaskManager.tsx
│   │   │   ├── ProgressLog.tsx
│   │   │   └── ui/             # shadcn/ui components
│   │   ├── hooks/
│   │   │   ├── useChat.ts       # SSE + 402 friendly message
│   │   │   ├── useFiles.ts
│   │   │   ├── useProjects.ts   # New: project CRUD
│   │   │   ├── useSessions.ts
│   │   │   ├── useSocket.ts
│   │   │   └── useTasks.ts
│   │   └── lib/
│   │       ├── api.ts           # REST client with auth headers
│   │       ├── auth-api.ts      # Auth-specific client
│   │       ├── utils.ts         # cn() helper
│   │       └── socket.ts        # ⚠ Não usado pelos componentes
│   └── public/
│       └── favicon.svg
│
├── workspace/                    # Per-user: workspace/<username>/
└── data/
    └── web-agent.db
```

---

## Dependências

### Backend (Production)
```
@ai-sdk/openai-compatible@0.2.16
ai@6.0.208
bcryptjs@2.4.3
better-sqlite3@12.11.1
chokidar@5.0.0
cors@2.8.6
dotenv@17.4.2
express@5.2.1
http-proxy-middleware@3.0.5
jsonwebtoken@9.0.2
multer@1.4.5-lts.2
socket.io@4.8.3
uuid@14.0.1
zod@3.25.76
```

### Frontend
```
react@19.x, react-dom@19.x
socket.io-client@4.x
tailwindcss@4.3.1
vite@8.0.16
lucide-react
@tailwindcss/vite@4.3.1
@vitejs/plugin-react@6.0.2
typescript@6.0.3
```

---

## Schema SQLite

8 tabelas: `sessions`, `messages`, `tasks`, `agent_steps`, `config`, `users`, `auth_sessions`, `credit_transactions`, `projects`

Ver detalhes completos em [`documentation.md`](documentation.md#8-banco-de-dados-sqlite).

---

## Próximos Passos

1. Implementar fluxo de aprovação completo (pausar agent antes de tool execution)
2. Conectar AbortController ao agent stream para cancelamento real
3. Substituir `grep` shell por busca em Node.js puro (cross-platform)
4. Adicionar path traversal protection nas agent tools
5. Remover código morto (`execution-sandbox.ts`, `lib/socket.ts`, `runTask()`)
6. Consolidar `listDir()` em módulo compartilhado
7. ~~Implementar restart-on-crash para Node.js subprocess projetos~~ ✅ (Implementado na Iteração 3 — Node projects start stopped)
8. Testar Docker build end-to-end
9. Adicionar validação de input (Zod) nas rotas REST
10. Considerar `@ai-sdk/openai-compatible@1.0+` quando estável

---

## Iteração 2 — Correções e Funcionalidades (Implementado)

### Bugs Corrigidos

| Bug | Severidade | Correção |
|-----|-----------|----------|
| Créditos não atualizam em tempo real | Crítico | `creditManager.setIo(io)` adicionado ao `setupWebSocket()`; re-join de room Socket.IO no `connect` |
| Links de projetos não funcionam (PHP, Node, Static) | Crítico | Symlink `<workspace>/<uuid>` → `<username>/<folderPath>/` para PHP; query strings preservadas; pathRewrite morto removido |

### Funcionalidades Adicionadas

| Feature | Descrição |
|---------|-----------|
| FileManager Explorer | Breadcrumbs clicáveis, botão voltar, duplo-clique para navegar, download de pasta como ZIP, extração de ZIP, upload binário corrigido |
| Novo Projeto com pasta existente | Checkbox + dropdown de pastas existentes no dialog "Novo Projeto" |
| Painel de Usuário (UserPanel) | 3 tabs: Conta (email editável), Segurança (trocar senha), Créditos (saldo + histórico). Substitui tab Admin para não-admins |
| Re-join Socket.IO | `user:join` re-enviado no `socket.on('connect')` para manter room membership após reconexões |
| `updateUser()` no AuthContext | Sincroniza mudanças de perfil (email) no state + localStorage sem re-login |
