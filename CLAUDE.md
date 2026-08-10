# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web Agent is a multi-user web development platform with an autonomous AI agent. Users get isolated workspaces where they can create web projects (static, PHP, Node.js), interact with an AI agent that builds/modifies code via chat, and publish projects with public URLs. An **Orchestrator** subsystem additionally runs multi-step, multi-agent workflows (planner → executor → verifier) for autonomous project delivery from an objective. UI and documentation are in English.

## Commands

```bash
# Backend development (port 89)
npm run dev              # tsx watch with hot reload
npm run build            # tsc + scripts/copy-preload.cjs
npm run start            # node dist/server.js (production)

# Frontend development (port 5173, proxies /api and /socket.io to :89)
npm run dev:frontend      # Vite dev server
npm run build:frontend    # Vite production build

# Docker (production)
docker compose up -d --build   # Access at http://localhost:89
```

**First-time setup:** `npm install && cd frontend && npm install && cd .. && cp .env.example .env`

No test runner or linter is configured in this project.

## Architecture

### Two-Package Layout (not a monorepo)

- **Root `package.json`** — backend (Node.js + Express + TypeScript, ESM)
- **`frontend/package.json`** — React 19 SPA (Vite 8 + TailwindCSS 4 + shadcn/ui)

Backend scripts delegate to frontend via `cd frontend && npm run ...`. No workspace manager.

### Request Flow

1. Browser → React SPA (Vite dev proxy or Express static in production)
2. Auth: JWT with access token (15min) + refresh token (7d). `AuthContext` manages `authFetch()` wrapper that adds Authorization header + transparent 401 retry with token refresh. No global `fetch` monkey-patching.
3. Chat: `POST /api/chat` (SSE) → `TaskManager` creates a `ToolLoopAgent` (Vercel AI SDK v6) → streams results via SSE, broadcasts credits via Socket.IO
4. Projects: `ProjectRouter` mounts projects — static via `express.static`, PHP via Apache proxy (port 8080), Node.js via child process + `http-proxy-middleware`

### Backend Structure (`src/`)

- **Entry point:** `server.ts` — Express + Socket.IO + DB init + bootstrap admin user + mount all routers + start file watcher + remount active projects
- **`agent/`** — AI agent core: `createAgent()` factory → `ToolLoopAgent` with provider + toolset. `instructions.ts` has system prompts (autocorrective + sub-agent). `provider.ts` wraps OpenAI-compatible API. Supports multi-turn conversation via `messages: ModelMessage[]` (falls back to `prompt: string`)
- **`agent/tools/`** — 10 tools (writeFile, readFile, listFiles, deleteFile, runCommand, executeCode, searchFiles, webFetch, installPackage, invokeSubAgent). `buildToolSet()` wraps tools with approval logic. `command-policy.ts` blocks dangerous shell patterns. `content-sanitize.ts` line-level filters prompt-injection attempts from read content. `sanitize.ts` provides `safeWorkspacePath()` used by both agent tools and `api/files.ts` (defense-in-depth: separator-suffix prefix check + `relative().startsWith('..')` traversal check). Sub-agent gets 5 tools, max 30 steps
- **`api/`** — 10 Express routers under `/api/` (auth, admin, chat, models, tasks, files, config, sessions, projects, orchestrator). Each uses `createXRouter(deps)` pattern injecting repositories/services. Authorization enforced: non-admins only see own resources. List endpoints support pagination (`limit`/`offset` query params). Chat router accepts `CompactionService` for auto-compaction and manual `/compact` endpoint. The orchestrator router exposes start/stop/pause/resume, status, steps, tasks, and `.md` upload endpoints
- **`orchestrator/`** — Multi-agent autonomous workflow subsystem. `OrchestratorManager` holds one `OrchestratorRunner` per session (multi-user concurrent runs). `OrchestratorRunner` runs a phased workflow: **plan** (`arquiteto` sub-agent scans codebase + LLM emits JSON task list) → **execute** (`programador` / `auxiliar` sub-agents execute tasks with dependency ordering, `MAX_PARALLEL_TASKS=1`, 3 retries per task, 1 re-plan attempt) → **verify** (`revisor` sub-agent reads files and returns PASS/FAIL). State machine persisted in `orchestrator_sessions` / `orchestrator_tasks` / `orchestrator_steps` / `orchestrator_state`. Constants: `MAX_TOTAL_STEPS=500`, `SUB_AGENT_TIMEOUT_MS=900_000`, `MAX_REPLAN_ATTEMPTS=1`, fallback model `openai/gpt-oss-120b`. Sub-agent toolsets are constructed **without** `buildToolSet`/`ApprovalManager` (see Known Limitations in security.md). `OrchestratorHeartbeat` (30s checks, 10min stale threshold) recovers running sessions on startup
- **`db/`** — SQLite via better-sqlite3 (WAL mode, `busy_timeout=5000`, integrity check on startup). `schema.ts` (14 tables: 10 main + 4 orchestrator; sessions has `summary_text`, messages has `is_compacted`), `migrate.ts` (ALTER TABLE migrations + index creation for existing DBs; placeholder `'__migration__'` is rewritten to admin id on next boot), `repositories/` (9 class-based repos: the 8 originals + `orchestrator.ts`). All types defined in `types/index.ts` (no duplicates in repos)
- **`services/`** — `TaskManager` (agent lifecycle + SSE streaming with abort signal check + multi-turn context forwarding; per-task Maps with explicit cleanup in three failure paths), `CreditManager` (per-step atomic deduction + Socket.IO broadcast), `ApprovalManager` (pending approvals with 5min timeout, ownership + admin-bypass + deny-by-default for null userId), `ProjectRouter` (mount/unmount/start/stop, auto-restart Node.js with exponential backoff max 5, port recycling pool 9000-65535, HTML `<base>` injection for sub-path deployments, SIGTERM→SIGKILL escalation 5s), `CompactionService` (auto-compact conversation context when token threshold exceeded, LLM summarization with head/tail fallback, `getConversationContext()` builds `ModelMessage[]`), `FileWatcher` (Chokidar; username→userId cache; `project:node-detected` scoped to owning user), `ModelResolver` (fetch models with 5min cache + fallback list), `Logger` (async write streams via `createWriteStream`, no sync I/O on event loop, stale stream prune at 2 days, `unref()`'d timers)
- **`preload/`** — `port-force.cjs` monkey-patches `net.Server.listen` to force PORT env var for Node.js project subprocesses (covers four `.listen()` argument shapes)
- **`lib/jwt.ts`** — `verifyToken()` / `verifyRefreshToken()` with **separate access/refresh secrets** (legacy `JWT_SECRET` maps to both for backward compatibility). Used by both HTTP auth middleware and Socket.IO handshake
- **`middleware/auth.ts`** — JWT verification middleware, no query-param token fallback. `middleware/admin.ts` is a pure 9-line role check
- **`websocket/`** — `setupWebSocket(io, …)` wires `io.use()` JWT handshake auth + per-event ownership checks. NB: socket handshake also accepts `socket.handshake.query.token` as a fallback to `auth.token` (see Known Limitations in security.md)

### Frontend Structure (`frontend/src/`)

- **Entry:** `main.tsx` → `App.tsx` wraps with `AuthProvider`, renders `Layout` or `LoginPage`
- **`contexts/AuthContext.tsx`** — Auth state + auto-refresh + Socket.IO singleton owner (connect/disconnect lifecycle) + `authFetch()` wrapper with inline Authorization header and 401 refresh retry. No `window.fetch` monkey-patching
- **`lib/socket.ts`** — Socket.IO singleton. `connectWithAuth(token)` / `disconnectSocket()` / `getSocket()`. Only `AuthContext` creates connections; all other code reads `getSocket()`
- **`components/`** — Layout, Sidebar, ChatPanel, FileManager, AdminPanel, ApprovalDialog, etc. + `ui/` (shadcn primitives). `ChatPanel` exposes `onStreamingChange` callback so Layout can derive `isRunning` state. ChatPanel supports slash commands (autocomplete dropdown with 6 commands), file attachment (📎 button + drag-and-drop), and `onNewSession`/`basePath` props
- **`hooks/`** — 8 hooks (useChat, useProjects, useFiles, useTasks, useSessions, useSocket, useResizable, useOrchestrator). `useChat` uses `messagesRef` to avoid stale closures. Tracks `activeTaskIdRef` for server-side force stop. Supports `addSystemMessage`, `clearChat`, `addAttachedFiles`/`clearAttachedFiles` for slash commands and file attach. `useOrchestrator` subscribes to `orchestrator:*` socket events with per-handler cleanup (capped 200-entry log history)
- **`lib/`** — API client (`api.ts` with authFetch integration + pagination params), auth API, utilities
- **Vite proxy** in `frontend/vite.config.ts`: `/api` and `/socket.io` → `http://localhost:89`

### Key Patterns

- **Router factory pattern:** API routers use `createXRouter({ repo, service, ... })` — dependencies injected, not imported
- **Repository class pattern:** Each DB table has a repository class with typed methods, instantiated with `db` instance. Types imported from `types/index.ts`, not redefined
- **Agent tool factory pattern:** Each tool is `createXTool(workspaceDir)` returning `{ description, parameters, execute }` — workspace-scoped
- **Approval wrapping:** `buildToolSet()` can wrap any tool with `ApprovalManager` based on `approvalMode` (`none`/`all`/`custom`)
- **Config with Docker rewrite:** `src/config.ts` auto-rewrites API URLs to `host.docker.internal` when running in Docker
- **Auth-aware fetch:** `authFetch()` in `AuthContext` wraps fetch with Authorization header. Registered with `api.ts` via `setAuthFetch()` on mount. No global `window.fetch` patching
- **Socket.IO singleton:** One connection managed by `AuthContext`. All hooks read via `getSocket()`. Never call `io()` outside `lib/socket.ts`
- **Multi-turn conversation:** Agent receives full conversation history as `messages: ModelMessage[]` (not just the last prompt). Context includes prior compaction summary as a `system` role message. Falls back to `prompt: string` if no context exists
- **Auto-compaction:** When estimated token count exceeds 60k threshold (~4 chars/token heuristic), `CompactionService` generates a summary via LLM, marks old messages as `is_compacted = 1`, and stores summary in `sessions.summary_text`. Agent receives summary + active messages automatically
- **Force stop:** Cancel button calls `api.tasks.cancel(taskId)` server-side (aborts the agent's `AbortController`) before aborting the local stream reader. Agent stops on the server, not just the client view
- **File attachment:** 📎 button opens file picker, uploads to workspace via `api.files.upload()`. Attached file paths prepended to next user message as context for the agent. Drag-and-drop also supported on the messages area
- **Slash commands:** 6 commands (`/clear`, `/new`, `/compact`, `/help`, `/model <name>`, `/steps <N>`) with autocomplete dropdown. Arrow key navigation, Tab/Enter to select, Escape to dismiss. Each executed client-side (no server round-trip except `/compact`)
- **Atomic credit operations:** `deduct()` uses `UPDATE ... WHERE credits >= ?` with `changes` count check. `addCredits()` uses `UPDATE SET credits = credits + ?`. No read-modify-write races
- **Safe path handling:** `safeWorkspacePath()` from `agent/tools/sanitize.ts` used by both file API and agent tools. Single source of truth, no local duplicates

### Database (SQLite)

14 tables: 10 main (`sessions`, `messages`, `tasks`, `agent_steps`, `config`, `users`, `auth_sessions`, `credit_transactions`, `projects`, `model_config`) + 4 orchestrator (`orchestrator_sessions`, `orchestrator_steps`, `orchestrator_tasks`, `orchestrator_state`). Foreign keys with CASCADE deletes. 7 indexes for `user_id` and `session_id` columns. Schema in `src/db/schema.ts`, migrations in `src/db/migrate.ts`. Sessions table has `summary_text` column for compaction summary. Messages table has `is_compacted` column for soft-hiding compacted messages. `orchestrator_state` is a singleton row (`id DEFAULT 'singleton'`).

### Real-time Communication

- **SSE** (`text/event-stream`): AI streaming from `POST /api/chat` via Vercel AI SDK `fullStream`. Generator checks `abortSignal.aborted` between chunks
- **Socket.IO**: One singleton connection. Credits updates, file changes, approval requests/responses, task progress — scoped to user rooms. JWT auth in handshake via `io.use()` middleware

## Environment Configuration

See `.env.example`. Key variables: `API_BASE_URL` (LLM provider), `API_KEY`, `PORT` (default 89), `WORKSPACE_BASE_DIR`, `DATA_DIR`, `MAX_STEPS` (default 100), `DEFAULT_MODEL`, `AGENT_TYPE` (main/sub/none), `DOCKER_CONTAINER`, `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` (recommended, separate; legacy `JWT_SECRET` maps to both), `ADMIN_PASSWORD`, `INITIAL_CREDITS` (default 100), `PUBLIC_BASE_URL`. Docker auto-rewrites localhost IPs to `host.docker.internal`.

**Required in production** (`NODE_ENV=production`): `JWT_SECRET` (or both `ACCESS_TOKEN_SECRET` + `REFRESH_TOKEN_SECRET`) and `ADMIN_PASSWORD` must be set — the server refuses to start without them. In development, fallback defaults are used with a warning.

Default admin login: username `admin`, password set via `ADMIN_PASSWORD` env (no default in production). NB: `ADMIN_PASSWORD` is authoritative — on every boot the server re-syncs the persisted admin password hash to match the env value (so changing the admin password via the UI is reverted on next restart; manage the admin secret via env/secrets, not the UI).
