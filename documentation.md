# Web Agent — Documentação Técnica

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura do Sistema](#2-arquitetura-do-sistema)
3. [Sistema Multi-Usuário](#3-sistema-multi-usuário)
4. [Agent Engine](#4-agent-engine)
5. [Ferramentas do Agente](#5-ferramentas-do-agente)
6. [APIs REST](#6-apis-rest)
7. [Comunicação Real-time (Socket.IO)](#7-comunicação-real-time-socketio)
8. [Banco de Dados (SQLite)](#8-banco-de-dados-sqlite)
9. [Frontend](#9-frontend)
10. [Sistema de Créditos](#10-sistema-de-créditos)
11. [Sistema de Projetos](#11-sistema-de-projetos)
12. [Configuração e Variáveis de Ambiente](#12-configuração-e-variáveis-de-ambiente)
13. [Deployment (Docker)](#13-deployment-docker)
14. [Desenvolvimento Local](#14-desenvolvimento-local)
15. [Bugs Conhecidos e Pendências](#15-bugs-conhecidos-e-pendências)
16. [Workarounds e Decisões Técnicas](#16-workarounds-e-decisões-técnicas)

---

## 1. Visão Geral

O **Web Agent** é uma plataforma multi-usuário de desenvolvimento web com agente de IA autônomo. Cada usuário possui workspace isolado, créditos, e pode criar projetos publicáveis via URL. O agente utiliza o Vercel AI SDK v6 (`ToolLoopAgent`) para executar tarefas através de um loop de raciocínio + ação.

### Características Principais

- **Multi-usuário**: Login/registro JWT com workspaces individuais (`workspaceBaseDir/<username>/`)
- **Sistema de créditos**: 1 crédito por step do agente, visas em tempo real via Socket.IO
- **Projetos publicáveis**: Cada projeto tem chat vinculado e URL pública (`/p/<uuid>/`)
- **Autonomia**: O agente trabalha sozinho até concluir a tarefa
- **Autocorreção**: Analisa erros, corrige e tenta novamente
- **Streaming em tempo real**: Progresso visualizado via SSE
- **9 ferramentas**: Execução de código, manipulação de arquivos, comandos shell, etc.
- **Tipos de projeto**: Static (HTML/CSS/JS), PHP (Apache), Node.js (Express)
- **Docker**: Base `php:8.3-apache-bookworm` com Apache (PHP) + Node.js (API) no mesmo container

### Stack

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Agent Framework | Vercel AI SDK v6 | `ai@6.0.208` |
| API Provider | `@ai-sdk/openai-compatible` | `0.2.16` |
| Backend | Express.js v5 + TypeScript 6 | `express@5.2.1` |
| Frontend | React 19 + Vite 8 + TailwindCSS 4 | `vite@8.0.16` |
| Real-time | SSE + Socket.IO | `socket.io@4.8.3` |
| Persistência | better-sqlite3 | `12.11.1` |
| Auth | JWT (bcryptjs + jsonwebtoken) | — |
| Proxy | http-proxy-middleware | — |
| Runtime | php:8.3-apache-bookworm (Docker) | Debian bookworm |

---

## 2. Arquitetura do Sistema

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (Frontend)                         │
│  React 19 + Vite 8 + TailwindCSS 4                           │
│  - LoginPage (auth)                                          │
│  - Sidebar (projects list)                                   │
│  - ChatPanel (SSE streaming)                                 │
│  - FileManager (tree + rename + delete + publish)           │
│  - AdminPanel (users, credits, stats)                        │
│  - Socket.IO client (credits:deducted, file:changed)         │
└──────────┬──────────────┬───────────────────────────────────┘
           │              │
     HTTP/SSE         WebSocket
           │              │
┌──────────▼──────────────▼───────────────────────────────────┐
│        Express Server (Port 89)                              │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Public Routes    │  │  Auth Routes      │                │
│  │  /api/auth/*      │  │  (no middleware)  │                │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Auth Routes      │  │  Admin Routes     │                │
│  │  authMiddleware   │  │  auth+admin       │                │
│  │  /api/chat, etc.  │  │  /api/admin/*     │                │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Project Router (/p/:uuid/*)                         │   │
│  │  - static: express.static(folder)                    │   │
│  │  - php: proxy → Apache :8080                          │   │
│  │  - node: spawn process + proxy → localhost:9000+      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Services Layer                                       │   │
│  │  - TaskManager (streamTask, credit deduction)        │   │
│  │  - CreditManager (deduct, hasCredits, WS events)     │   │
│  │  - ProjectRouter (mount/unmount/shutdownAll)         │   │
│  │  - ApprovalManager                                    │   │
│  │  - ModelResolver (cache 5min)                         │   │
│  │  - FileWatcher (chokidar on workspaceBaseDir)         │   │
│  └─────────────────────────────┬────────────────────────┘   │
│                                 │                             │
│  ┌──────────────────────────────▼─────────────────────────┐  │
│  │  Agent Engine (ai@6.0.208)                            │  │
│  │  ToolLoopAgent + 9 tools + autocorrective prompt      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────┐  ┌────────────────────────────────┐   │
│  │  SQLite (WAL)    │  │  Workspaces                     │   │
│  │  web-agent.db    │  │  workspaceBaseDir/<username>/    │   │
│  └─────────────────┘  └────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Apache (Port 8080 — internal only)                   │  │
│  │  Serves PHP projects via VirtualHost                  │   │
│  │  Projects VirtualHost: /var/www/projects/             │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Fluxo de Dados

```
User Login → JWT auth → Per-user workspace resolution
User creates Project → auto-creates Session + folder in workspace
User chats in Project → POST /api/chat (with sessionId from project)
  → Credit check (402 if exhausted)
  → TaskManager.createTask(sessionId, ..., userId, workspaceDir)
  → TaskManager.streamTask()
    → onStepFinish: creditManager.deductCredit(userId, taskId)
    → Socket.IO: credits:deducted → frontend updates balance in real-time
    → On credit exhaustion: abortController.abort()
  → SSE text/event-stream → ChatPanel
User publishes project → /p/<uuid>/ → ProjectRouter middleware
```

---

## 3. Sistema Multi-Usuário

### Autenticação

- **Login/Register**: `POST /api/auth/login`, `POST /api/auth/register`
- **JWT**: Access token (15min) + Refresh token (7 dias, hash armazenado no DB)
- **Refresh rotation**: A cada refresh, o token antigo é deletado e um novo é emitido
- **Middleware**: `authMiddleware` extrai Bearer token, verifica JWT, define `req.user = { userId, role }`
- **AdminMiddleware**: Verifica `req.user.role === 'admin'` para rotas admin

### Workspaces Per-User

Cada usuário tem um workspace isolado em `workspaceBaseDir/<username>/`:
- Diretório criado automaticamente no registro (`src/api/auth.ts`)
- No startup, o servidor cria dirs para todos os usuários existentes (`src/server.ts`)
- `GET /api/files` usa `getWorkspaceDir(req)` que resolve via `req.user.userId` → DB lookup → `resolve(baseDir, username)`
- Sem autenticação: retorna 401 (nunca cai para workspace global)
- Path traversal protection via `safePath()` em todas as rotas de arquivos

### Bootstrap do Admin

No primeiro startup, o servidor:
1. Cria usuário `admin` com senha de `ADMIN_PASSWORD` (env) ou `admin123`
2. Atribui 999999 créditos ao admin
3. Migra registros órfãos (sem `user_id`) para o admin
4. Cria sessão default se não existe nenhuma
5. Cria diretórios de workspace para todos os usuários
6. Remonta todos os projetos ativos do DB

---

## 4. Agent Engine

### ToolLoopAgent (Vercel AI SDK v6)

O agente é criado via `createAgent()` em `src/agent/index.ts`:

```typescript
const agent = new ToolLoopAgent({
  model: provider.chatModel(options.model) as any,
  instructions: AUTOCORRECTIVE_SYSTEM_PROMPT,
  tools,
  stopWhen: stepCountIs(options.maxSteps),
  maxOutputTokens: 4096,
});
```

### Provider

`src/agent/provider.ts` — Provider OpenAI-compatible customizado:

```typescript
export function createProvider(apiBaseUrl: string, apiKey: string) {
  return createOpenAICompatible({
    name: 'nvidia-nims',
    baseURL: apiBaseUrl,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}
```

**Notas:**
- NÃO usa `apiKey` nomeado (não suportado pelo `@ai-sdk/openai-compatible@0.2`)
- `provider.chatModel(modelId)` retorna `LanguageModelV1`, mas `ToolLoopAgent` espera `LanguageModelV2/V3` — daí o `as any`

---

## 5. Ferramentas do Agente

Todas as tools usam `inputSchema` (AI SDK v6) com Zod. O workspace é por usuário:

| # | Ferramenta | Arquivo | Descrição |
|---|-----------|---------|-----------|
| 1 | writeFile | `write-file.ts` | Criar/editar arquivos no workspace |
| 2 | readFile | `read-file.ts` | Ler conteúdo de arquivos |
| 3 | listFiles | `list-files.ts` | Listar diretórios (recursive option) |
| 4 | deleteFile | `delete-file.ts` | Remover arquivos ou diretórios |
| 5 | runCommand | `run-command.ts` | Comandos shell (execSync, cwd=workspaceDir) |
| 6 | executeCode | `execute-code.ts` | Executar JS/TS/Python |
| 7 | searchFiles | `search-files.ts` | Buscar padrões (grep) |
| 8 | webFetch | `web-fetch.ts` | HTTP GET com timeout 15s |
| 9 | installPackage | `install-package.ts` | npm install ou pip install |

Registro central: `src/agent/tools/index.ts` — `buildToolSet()` com lógica de aprovação.

> **NOTA**: O `needsApproval` é spread no tool object mas o `ToolLoopAgent` não reconhece nativamente. Tools com `needsApproval: true` executam sem pausar para aprovação.

---

## 6. APIs REST

### Rotas Públicas (sem auth)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Login (retorna JWT + user) |
| `POST` | `/api/auth/register` | Registro (cria user + workspace) |
| `POST` | `/api/auth/refresh` | Refresh token rotation |
| `GET` | `/api/auth/me` | Dados do usuário logado |
| `POST` | `/api/auth/logout` | Invalida refresh token |

### Rotas Autenticadas (authMiddleware)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/chat` | Chat com agente (SSE, credit check) |
| `GET` | `/api/models` | Modelos disponíveis (cache 5min) |
| `GET/POST` | `/api/tasks` | Listar/criar tarefas |
| `PATCH` | `/api/tasks/:id` | Atualizar/cancelar tarefa |
| `GET` | `/api/tasks/:id/steps` | Steps do agente |
| `GET/PUT/DELETE/POST` | `/api/files/*` | Operações de arquivo (per-user) |
| `POST` | `/api/files/rename` | Renomear arquivo/pasta |
| `POST` | `/api/files/create-file` | Criar arquivo vazio |
| `POST` | `/api/files/mkdir` | Criar diretório |
| `POST` | `/api/files/upload` | Upload de arquivos (multipart) |
| `GET` | `/api/files/download` | Download com token auth |
| `GET/PUT` | `/api/config` | Configurações |
| `GET/POST` | `/api/sessions` | Sessões (filtradas por user) |
| `GET` | `/api/sessions/:id/messages` | Mensagens de uma sessão |
| `DELETE` | `/api/sessions/:id` | Deletar sessão (cascade) |
| `GET/POST` | `/api/projects` | Listar/criar projetos (auto-creates session) |
| `GET/DELETE` | `/api/projects/:id` | Ver/deletar projeto |

### Rotas Admin (authMiddleware + adminMiddleware)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/users` | Listar todos os usuários |
| `POST` | `/api/admin/users/:id/credits` | Adicionar créditos |
| `PATCH` | `/api/admin/users/:id/role` | Alterar role (admin/user) |
| `DELETE` | `/api/admin/users/:id` | Deletar usuário |
| `GET` | `/api/admin/users/:id/credits/history` | Histórico de créditos |
| `GET` | `/api/admin/stats` | Estatísticas globais |

### Rotas de Projeto (públicas, sem auth — UUID-based)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/p/<uuid>/*` | Servir projeto publicado (static/php/node) |

---

## 7. Comunicação Real-time (Socket.IO)

### Eventos Server → Client

| Evento | Dados | Descrição |
|--------|-------|-----------|
| `task:created` | `{ task }` | Nova tarefa criada |
| `task:step` | `{ taskId, stepNumber, toolCalls }` | Step do agente finalizado |
| `task:completed` | `{ taskId }` | Tarefa concluída |
| `task:failed` | `{ taskId, error }` | Tarefa falhou |
| `task:cancelled` | `{ taskId }` | Tarefa cancelada |
| `file:changed` | `{ path, type }` | Arquivo modificado (create/modify/delete) |
| `credits:deducted` | `{ userId, taskId, newBalance, deducted }` | Crédito debitado |
| `credits:exhausted` | `{ userId, taskId }` | Créditos esgotados |
| `approval:request` | `{ id, toolName, toolInput }` | Solicitação de aprovação |

### Eventos Client → Server

| Evento | Dados | Descrição |
|--------|-------|-----------|
| `session:join` | `{ sessionId }` | Entrar na room da sessão |
| `task:subscribe` | `{ taskId }` | Receber updates de tarefa |
| `approval:respond` | `{ id, approved }` | Responder aprovação |
| `task:cancel` | `{ taskId }` | Cancelar tarefa |

---

## 8. Banco de Dados (SQLite)

### Localização

- Desenvolvimento: `./data/web-agent.db`
- Produção (Docker): `/app/data/web-agent.db`

### Tabelas

#### users
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| username | TEXT UNIQUE | Nome de usuário |
| email | TEXT | Email (opcional) |
| password_hash | TEXT | bcrypt hash |
| role | TEXT | admin/user |
| credits | INTEGER | Saldo atual de créditos |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### auth_sessions
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | Referência ao usuário |
| refresh_token_hash | TEXT | bcrypt hash do refresh token |
| expires_at | DATETIME | Expiração (7 dias) |
| created_at | DATETIME | |

#### sessions
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| name | TEXT | Nome da sessão |
| model | TEXT | Modelo default |
| user_id | TEXT | Dono da sessão (nullable para legado) |
| project_id | TEXT | Projeto vinculado (nullable) |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### messages
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| session_id | TEXT FK | Sessão (ON DELETE CASCADE) |
| role | TEXT | user/assistant/system/tool |
| content | TEXT | Conteúdo |
| tool_calls | TEXT | JSON de tool calls |
| tool_call_id | TEXT | ID do tool call |
| step_number | INTEGER | Step do agente |
| user_id | TEXT | Dono da mensagem |
| created_at | DATETIME | |

#### tasks
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| session_id | TEXT FK | Sessão (ON DELETE CASCADE) |
| description | TEXT | Descrição da tarefa |
| status | TEXT | pending/running/completed/failed/cancelled |
| model | TEXT | Modelo utilizado |
| max_steps | INTEGER | Limite de steps (default: 100) |
| current_step | INTEGER | Step atual |
| result | TEXT | Resultado final |
| error | TEXT | Mensagem de erro |
| user_id | TEXT | Dono da tarefa |
| workspace_dir | TEXT | Diretório workspace per-user |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### projects
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID interno |
| uuid | TEXT UNIQUE | UUID público (usado na URL /p/\<uuid\>/) |
| user_id | TEXT FK | Dono do projeto (ON DELETE CASCADE) |
| name | TEXT | Nome do projeto |
| folder_path | TEXT | Path relativo no workspace |
| type | TEXT | static/php/node |
| port | INTEGER | Porta de processo Node.js |
| pid | INTEGER | PID do processo Node.js |
| status | TEXT | active/stopped/error |
| session_id | TEXT | Sessão de chat vinculada |
| created_at | DATETIME | |
| updated_at | DATETIME | |

#### credit_transactions
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | Referência ao usuário (ON DELETE CASCADE) |
| amount | INTEGER | Positivo=add, negativo=deduct |
| balance_after | INTEGER | Saldo após transação |
| type | TEXT | purchase/consumption/refund/bonus |
| description | TEXT | Descrição |
| task_id | TEXT | Tarefa vinculada |
| created_at | DATETIME | |

#### agent_steps
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| task_id | TEXT FK | Tarefa (ON DELETE CASCADE) |
| step_number | INTEGER | Número do step |
| tool_name | TEXT | Nome da ferramenta |
| tool_input | TEXT | JSON com input |
| tool_output | TEXT | JSON com output |
| reasoning | TEXT | Raciocínio |
| duration_ms | INTEGER | Duração em ms |
| status | TEXT | success/error |
| created_at | DATETIME | |

> **NOTA**: `agent_steps` é populada pelo `TaskManager.insertStep()` durante streamTask.

#### config
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| key | TEXT PK | Nome da configuração |
| value | TEXT | Valor (string/JSON) |
| updated_at | DATETIME | |

### Migração

`src/db/migrate.ts` executa ALTER TABLEs idempotentes (try/catch com "duplicate column name") para adicionar colunas novas em bancos existentes:
- `sessions.user_id`, `messages.user_id`, `tasks.user_id`, `tasks.workspace_dir`
- `sessions.project_id`, `projects.session_id`

---

## 9. Frontend

### Layout

```
┌──────────────┬──────────────────────────────────────────┐
│   Sidebar    │  [Chat] [Files] [Config] [Admin]         │
│              ├──────────────────────────────────────────┤
│  Projects    │                                          │
│  ─────────  │  Content area based on active tab        │
│  ● My Site   │                                          │
│  ● App Node  │  Chat: ChatPanel with project session    │
│  ● Blog PHP  │  Files: FileManager with rename/delete   │
│              │  Config: ConfigPanel                      │
│  [+ New]    │  Admin: AdminPanel (if admin)             │
│              │                                          │
│  ───────    │──────────────────────────────────────────│
│  👤 admin   │                                          │
│  999999 cr  │                                          │
└──────────────┴──────────────────────────────────────────┘
```

### Componentes

| Componente | Arquivo | Funcionalidade |
|-----------|---------|---------------|
| App | `App.tsx` | AuthProvider wrapper, Login/Layout switch |
| LoginPage | `LoginPage.tsx` | Login/Register com tabs |
| Layout | `Layout.tsx` | Sidebar + tabs, gerencia projeto ativo |
| Sidebar | `Sidebar.tsx` | Lista de projetos com badges (S/P/N), delete, open URL |
| ChatPanel | `ChatPanel.tsx` | SSE streaming + seletor de modelo |
| MessageBubble | `MessageBubble.tsx` | Render Markdown + tool calls inline |
| ToolCallDisplay | `ToolCallDisplay.tsx` | Accordion para tool inputs/outputs |
| StepProgressBar | `StepProgressBar.tsx` | Barra de progresso |
| TypingIndicator | `TypingIndicator.tsx` | Indicador de digitação |
| FileManager | `FileManager.tsx` | Árvore + preview + rename + delete + create + publish |
| ConfigPanel | `ConfigPanel.tsx` | Modelo, steps, aprovação, API |
| AdminPanel | `AdminPanel.tsx` | Usuários, créditos, histórico, stats |
| PublishProjectDialog | `PublishProjectDialog.tsx` | Dialog para publicar pasta como projeto |
| ApprovalDialog | `ApprovalDialog.tsx` | Modal de aprovação de ferramentas |

### Contextos

| Context | Arquivo | Funcionalidade |
|---------|---------|---------------|
| AuthContext | `contexts/AuthContext.tsx` | Auth state, login/register/logout, auto-refresh 14min, Socket.IO credits listener, fetch 401 interceptor |

### Hooks

| Hook | Arquivo | Funcionalidade |
|------|---------|---------------|
| `useSocket` | `hooks/useSocket.ts` | Conexão Socket.IO singleton |
| `useChat` | `hooks/useChat.ts` | SSE fetch + messages state + cancel + 402 friendly message |
| `useTasks` | `hooks/useTasks.ts` | CRUD de tarefas + Socket.IO updates |
| `useFiles` | `hooks/useFiles.ts` | Tree + content + refresh |
| `useSessions` | `hooks/useSessions.ts` | CRUD de sessões |
| `useProjects` | `hooks/useProjects.ts` | CRUD de projetos (list, create, delete) |

### Libs

| Lib | Arquivo | Uso |
|-----|---------|-----|
| `api.ts` | `lib/api.ts` | Cliente REST com auth headers (Bearer token) |
| `auth-api.ts` | `lib/auth-api.ts` | Cliente de auth (login, register, refresh, me, logout) |
| `utils.ts` | `lib/utils.ts` | `cn()` helper (Tailwind) |

---

## 10. Sistema de Créditos

### Modelo

- 1 crédito = 1 step do agente (cada chamada de ferramenta com resultado)
- Steps sem tool calls (apenas texto) não custam créditos
- Steps com múltiplas tool calls em paralelo custam apenas 1 crédito

### Fluxo de Dedução

```
TaskManager.streamTask() → onStepFinish()
  → if userId && toolResults.length > 0:
    → creditManager.deductCredit(userId, taskId)
      → creditsRepo.getBalance(userId) → check > 0
      → creditsRepo.deduct(userId, 1, 'consumption', ...)
      → Socket.IO: credits:deducted { userId, newBalance }
      → if newBalance <= 0: Socket.IO: credits:exhausted
    → on error (exhausted): abortController.abort()
```

### Pré-verificação

`POST /api/chat` verifica `creditManager.hasCredits(userId)` antes de criar a tarefa. Retorna 402 se sem créditos.

### Frontend — Atualização em Tempo Real

`AuthContext` conecta ao Socket.IO e escuta:
- `credits:deducted` → `updateCredits(data.newBalance)` — atualiza saldo instantaneamente
- `credits:exhausted` → `updateCredits(0)`

Saldo exibido no Sidebar footer. Mensagem amigável "Créditos esgotados" em vez de "API error: 402".

### Créditos Iniciais

- Novo usuário: 100 créditos (configurável via `INITIAL_CREDITS`)
- Admin bootstrap: 999999 créditos

---

## 11. Sistema de Projetos

### Conceito

Cada projeto tem:
- Uma **sessão de chat** vinculada (1:1) — o histórico é o contexto do agente
- Uma **pasta no workspace** — onde os arquivos do projeto vivem
- Uma **URL pública** `/p/<uuid>/` — acessível sem autenticação

### Criação de Projeto

1. Usuário clica "+" na sidebar → "Novo Projeto" dialog
2. Informa nome e tipo (static/php/node)
3. Backend: `POST /api/projects`
   - Cria sessão vinculada ao usuário
   - Cria pasta no workspace (`workspaceBaseDir/<username>/<slug>`)
   - Cria registro no DB com `session_id` vinculado
   - Monta o projeto no ProjectRouter (static=express.static, php=proxy Apache, node=spawn+proxy)
4. Frontend: abre ChatPanel com `sessionId` do projeto

### Publicação de Pasta Existente

O botão "Publish" no FileManager abre `PublishProjectDialog`:
- Usa pasta já existente no workspace
- Não cria sessão (usa o projeto existente)

### ProjectRouter

Middleware Express em `/p` que:
1. Extrai UUID da URL: `/p/<uuid>/<path>`
2. Procura no `activeProjects` Map (em memória)
3. Delega ao middleware do projeto:
   - **static**: `express.static(fullFolderPath)`
   - **php**: `createProxyMiddleware({ target: http://localhost:8080/<uuid>/ })`
   - **node**: spawn child process na porta 9000+, proxy para `http://localhost:<port>`

### Re-mount no Startup

O servidor remonta automaticamente todos os projetos com status `active` do DB:
```typescript
const allProjects = projectsRepo.listAll();
for (const p of allProjects) {
  projectRouter.mountProject(p, fullFolderPath);
}
```

---

## 12. Configuração e Variáveis de Ambiente

### .env

| Variável | Default | Descrição |
|----------|---------|-----------|
| `API_BASE_URL` | `http://192.168.3.5:11431/v1` | URL base da API LLM |
| `API_KEY` | — | Chave de API |
| `PORT` | `89` | Porta do servidor |
| `WORKSPACE_DIR` | `./workspace` | Diretório workspace (legacy) |
| `WORKSPACE_BASE_DIR` | `./workspace` | Base dir para workspaces per-user |
| `DATA_DIR` | `./data` | Diretório do SQLite |
| `MAX_STEPS` | `100` | Limite de steps |
| `DEFAULT_MODEL` | `z-ai/glm-5.1` | Modelo padrão |
| `AGENT_TYPE` | `none` | Tipo de agente |
| `JWT_SECRET` | `web-agent-jwt-secret-...` | Secret para assinar JWTs |
| `ADMIN_PASSWORD` | `admin123` | Senha do admin bootstrap |
| `INITIAL_CREDITS` | `100` | Créditos para novos usuários |
| `DOCKER_CONTAINER` | — | Flag para URL rewriting em Docker |

---

## 13. Deployment (Docker)

### Dockerfile (Multi-stage)

Base: `php:8.3-apache-bookworm` (Debian bookworm). Inclui Apache + PHP + Node.js 22 + Composer.

1. **builder-frontend**: Build do Vite → `frontend/dist/`
2. **builder-backend**: Compilação TypeScript → `dist/`
3. **runtime**: Apache + Node.js + Composer via installer (não apt, para evitar conflitos de dependência PHP)

### Entry Point

`docker-start.sh`:
```bash
apache2ctl start     # Apache na porta 8080 (interna)
exec node dist/server.js  # Node.js na porta 89 (externa)
```

### Apache

- `apache/ports.conf`: Listen 8080
- `apache/projects.conf`: VirtualHost para projetos PHP
- Módulos: rewrite, proxy, proxy_http, headers

### docker-compose.yml

```yaml
services:
  web-agent:
    build: .
    container_name: web-agent
    ports:
      - "89:89"
    volumes:
      - ./workspace:/app/workspace
      - ./data:/app/data
    env_file: .env
    environment:
      - NODE_ENV=production
      - DOCKER_CONTAINER=1
      - WORKSPACE_BASE_DIR=/app/workspace
      - JWT_SECRET=${JWT_SECRET:-web-agent-jwt-secret-change-me}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}
      - INITIAL_CREDITS=100
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
```

### Volumes

| Volume | Container Path | Propósito |
|--------|---------------|-----------|
| `./workspace` | `/app/workspace` | Workspaces per-user (subdirs por username) |
| `./data` | `/app/data` | Banco SQLite + dados persistentes |

---

## 14. Desenvolvimento Local

### Setup

```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env
# Edite .env com API_BASE_URL e API_KEY
```

### Execução

```bash
# Terminal 1: Backend (porta 89)
npm run dev

# Terminal 2: Frontend (porta 5173, proxy para :89)
npm run dev:frontend
```

Acesse `http://localhost:5173` em dev (Vite proxy) ou `http://localhost:89` em produção.

### Build

```bash
npm run build
npm run build:frontend
docker compose build && docker compose up -d
```

### Verificação

```bash
npx tsc --noEmit          # Backend — zero erros
cd frontend && npx tsc --noEmit  # Frontend — zero erros
```

---

## 15. Bugs Conhecidos e Pendências

### Críticos

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 1 | Fluxo de aprovação não pausa execução | Tools com `needsApproval` executam sem aprovação | `src/agent/tools/index.ts` |
| 2 | AbortController não aborta LLM em stream | Cancelar tarefa não interrompe a chamada LLM ativa | `src/services/task-manager.ts` |

### Médios

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 3 | `search-files.ts` usa `grep` | Não funciona em Windows; shell injection | `src/agent/tools/search-files.ts` |
| 4 | `run-command.ts` stderr vazio em sucesso | Não captura stderr quando exitCode=0 | `src/agent/tools/run-command.ts` |
| 5 | Sem path traversal protection nas agent tools | Agente pode acessar arquivos fora do workspace via `../` | Todas as agent tools com `path` |
| 6 | `web-fetch.ts` ignora `format` | Parâmetro declarado mas não usado | `src/agent/tools/web-fetch.ts` |

### Baixos

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 7 | `execution-sandbox.ts` é código morto | Nunca importado | `src/services/execution-sandbox.ts` |
| 8 | `lib/socket.ts` (frontend) não é usado | Conexão órfã | `frontend/src/lib/socket.ts` |
| 9 | `runTask()` (non-streaming) nunca chamado | Método morto | `src/services/task-manager.ts` |
| 10 | `listDir()` duplicado | DRY violation | `list-files.ts` + `files.ts` |
| 11 | Node.js projects sem restart-on-crash | Se o processo Node morre, o proxy retorna erro | `src/services/project-router.ts` |
| 12 | No PM2/process management para Node projects | Subprocessos criados via raw `child_process.spawn` | `src/services/project-router.ts` |

---

## 16. Workarounds e Decisões Técnicas

| Decisão | Motivo |
|---------|--------|
| `bcryptjs` ao invés de `bcrypt` | Pure JS, sem native bindings, funciona em qualquer ambiente |
| JWT com access (15min) + refresh (7d) | Segurança: access token curto, refresh com hash no DB |
| Refresh token rotation | Previne replay attacks — old token deletado a cada refresh |
| UUIDs duplos em projects (`id` + `uuid`) | `id` interno, `uuid` público na URL — não vaza IDs internos |
| `workspaceBaseDir/<username>/` | Isolamento de workspace por usuário — resolve via DB lookup |
| `catch {}` removido de `getWorkspaceDir()` | Sempre retorna 401 se sem auth — nunca cai para workspace global |
| Composer via installer (não apt) | `php:8.3-apache-bookworm` tem PHP compilado, pacote Debian `composer` conflita |
| `mkdirSync` em `getWorkspaceDir()` | Garante que dir existe ao listar arquivos, mesmo se criado por outra via |
| File watcher em `workspaceBaseDir` inteiro | Observa mudanças em todos os workspaces, não apenas admin |
| Re-mount de projetos no startup | Projetos persistidos no DB mas rotas são em memória — re-cria ao subir |
| 402 com mensagem amigável no frontend | `useChat` detecta 402 e exibe "Créditos esgotados" em vez de erro genérico |
| `provider.chatModel() as any` | `@ai-sdk/openai-compatible@0.2` retorna `LanguageModelV1`, `ai@6` espera V2/V3 |
| Express v5 wildcard `'{*path}'` | Express 5 usa path-to-regexp v8 com wildcards nomeados |
| AI SDK v6 `inputSchema` ao invés de `parameters` | API mudou na v6 |
| Sidebar mostra projetos, não sessões | Cada projeto = chat + workspace + URL pública; sessão vinculada automaticamente |
| CSS `hidden` para persistência de layout | React conditional render destroy state; `hidden` mantém mounted |
