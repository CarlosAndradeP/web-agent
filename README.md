# Web Agent

Multi-user web development platform with an autonomous AI agent. Each user gets an isolated workspace with a configurable per-model credit system, and can create publishable projects with linked chat sessions and public URLs.

## Stack

- **Backend**: Express v5 + TypeScript + SQLite (better-sqlite3)
- **Agent**: Vercel AI SDK v6 (ToolLoopAgent) + 10 tools + sub-agent + autocorrection
- **Orchestrator**: Multi-agent autonomous workflow subsystem (arquiteto → programador/auxiliar → revisor)
- **Auth**: JWT (bcryptjs) with access token (15min) + refresh token (7d), **separate access/refresh secrets** (legacy `JWT_SECRET` maps to both). Authenticated fetch via `authFetch()` wrapper (no global monkey-patching)
- **Frontend**: React 19 + Vite 8 + TailwindCSS 4 + shadcn/ui (resizable layout, drag handles, visual polish)
- **Real-time**: SSE (streaming) + Socket.IO (credits, file changes, approvals — singleton connection)
- **Projects**: Static (express.static) / PHP (Apache 8080) / Node.js (spawn + proxy, auto-restart with exponential backoff)
- **Docker**: `php:8.3-apache-bookworm` — Apache + Node.js in same container

## Quick Start

### Docker (Production)

```bash
cp .env.example .env
# Edit .env — MUST set: API_BASE_URL, API_KEY, JWT_SECRET, ADMIN_PASSWORD
docker compose up -d --build
# Access http://localhost:89
```

> **Security:** `JWT_SECRET` and `ADMIN_PASSWORD` are required in production. The server refuses to start without them.

### Local Development

```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env

# Terminal 1 — Backend (port 89)
npm run dev

# Terminal 2 — Frontend (port 5173, proxies /api and /socket.io to :89)
npm run dev:frontend
# Access http://localhost:5173
```

## Features

### Multi-user
- JWT login/register with transparent 401 retry and token rotation
- Admin can pause new registrations (toggle in Settings panel)
- Isolated workspaces per user (`workspace/<username>/`)
- Admin panel: manage users, credits, roles, settings

### Credit System
- Per-model configurable cost per step (admin defines in panel)
- Real-time updates via Socket.IO (room-scoped per user)
- Task auto-aborted if credits exhausted
- Friendly "Credits exhausted" message
- New users: 100 credits (configurable)

### Model Management (Admin)
- Enable/disable models for users
- Set cost per step for each model
- Set custom display name
- Offline models (unavailable in API) are flagged
- Changes reflect immediately in user chat

### Projects
- Sidebar shows projects (not sessions)
- Each project has linked chat = agent context
- Each project operates in its subfolder within workspace (isolation)
- Public URL: `/p/<uuid>/`
- 3 types: Static, PHP (Apache), Node.js (subprocess)
- Node.js projects are created stopped (manual start) — entrypoint verification before starting
- Node.js auto-restart on crash with exponential backoff (max 5 restarts, delay 1s → 16s → 30s cap)
- Port recycling pool (9000–65535) — ports released on stop/unmount
- Publish directly from FileManager
- Projects with mount failures are marked as `error`

### FileManager
- Explorer-style navigation with clickable breadcrumbs
- Double-click folder to navigate into
- Back button (parent level)
- Scoped to active project (doesn't list entire workspace)
- Create file/folder, rename, delete (file and folder)
- Upload drag & drop (files and .zip)
- Download folder as ZIP
- Extract ZIP directly in manager
- Publish folder as project
- Resizable file tree via drag (localStorage, double-click reset)

### Autonomous Agent
- 10 tools: writeFile, readFile, listFiles, deleteFile, runCommand, executeCode, searchFiles, webFetch, installPackage, invokeSubAgent
- Sub-agent: delegate sub-tasks to child agent (5 tools, limited maxSteps)
- **Multi-turn conversation** — Agent receives full conversation history (not just the last message). Context includes prior compaction summaries
- **Auto-compaction** — When conversation exceeds token threshold (~60k estimated tokens), context is automatically summarized via LLM. Old messages are soft-hidden (`is_compacted=1`), summary stored in session. Manual trigger via `/compact`
- Knows project public URL (via `PUBLIC_BASE_URL`)
- Autocorrection: analyzes errors, fixes and retries
- Real-time streaming via SSE with contextual indicators per tool
- **Force stop** — Cancel button kills the server-side agent (AbortController), not just the client stream
- Configurable approval (none/all/custom) — default: `none` (immediate execution); user can enable in ConfigPanel
- Operates in active project scope (project workspace, not user root)
- `webFetch` tool has SSRF protection: blocks private IPs, link-local, cloud metadata (169.254.169.254), octal/hex IPs, post-DNS resolution checks
- `installPackage` uses `execFile()` (no shell interpolation)

### Orchestrator (Autonomous Project Delivery)
- Multi-agent workflow subsystem that runs full project delivery from a single objective
- **Phases**: `plan` (arquiteto scans codebase + LLM emits JSON task list) → `execute` (programador/auxiliar sub-agents execute tasks with dependency ordering) → `verify` (revisor reads files and returns PASS/FAIL)
- **Multi-user concurrent runs**: one `OrchestratorRunner` per session, managed by `OrchestratorManager`
- **Constants**: `MAX_TOTAL_STEPS=500`, `MAX_PARALLEL_TASKS=1`, `TASK_MAX_RETRIES=3`, `MAX_REPLAN_ATTEMPTS=1`, `SUB_AGENT_TIMEOUT_MS=900_000` (15min). Fallback model: `openai/gpt-oss-120b`
- **Re-plan on repeated failure**: if a task fails all 3 retries, `arquiteto` proposes 2-3 smaller replacement tasks (max 1 re-plan attempt)
- **File-state diffing**: programador runs attribute created/modified files and feed them into subsequent tasks' `previousResults` context
- **Heartbeat**: 30s checks, 10min stale threshold — on stale, all runners shut down and corresponding sessions marked failed. On server restart, running sessions are recovered
- **Credit deduction**: per-task after sub-agent completes (admins are exempt). Same execute-then-bill model as the chat agent
- **`.md` file upload**: planning context can be augmented by uploading Markdown spec files (max 20 files, 10MB each)
- Sub-agent toolsets are constructed **without** ApprovalManager bypassing the global `approvalMode` — see security.md Known Limitations
- Frontend: `AutonomousPanel` + `Orchestrator*` components driven by `useOrchestrator` hook (subscribes to `orchestrator:*` socket events with 200-entry log history cap)

### Chat Input
- **Slash commands** — 6 commands with autocomplete:
  - `/clear` — Clear chat messages
  - `/new` — Start a new session
  - `/compact` — Compact conversation context
  - `/help` — Show available commands
  - `/model <name>` — Switch model (partial match)
  - `/steps <N>` — Set max agent steps (1–200)
- **File attachment** — 📎 button opens file picker, uploads to project workspace. Attached files listed as removable pills. Next message includes file paths for agent context. Drag-and-drop supported on messages area
- **System messages** — Command feedback and upload confirmations shown as styled system messages in chat

### Layout & UI
- Resizable sidebar via drag (200–400px, default 240px, localStorage)
- Resizable file tree via drag (200–480px, default 260px, localStorage)
- Resize handles: 3px pill with blue hover, double-click resets to default width
- Global `col-resize` cursor during drag (via CSS `body[data-resizing]`)
- Mobile: sidebar overlay with backdrop-blur, entrance animation
- Consistent dark design: `/60` borders, opaque backgrounds, subtle border badges
- Empty states with Lucide icons in rounded containers
- Running indicators in emerald (green), blue accents only for active navigation
- `isRunning` state derived from chat streaming (not hardcoded)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_BASE_URL` | `http://192.168.3.5:11431/v1` (rewritten to `host.docker.internal` in Docker) | LLM provider API URL (OpenAI-compatible) |
| `API_KEY` | — | LLM API key |
| `PORT` | `89` | Server port |
| `WORKSPACE_BASE_DIR` | `./workspace` | Per-user workspace base directory (each user gets `workspace/<username>/`) |
| `DATA_DIR` | `./data` | SQLite database directory |
| `MAX_STEPS` | `100` | Max agent steps per task |
| `DEFAULT_MODEL` | `z-ai/glm-5.2` | Default LLM model |
| `ACCESS_TOKEN_SECRET` | *(recommended, separate)* | Access token JWT secret (15min tokens) |
| `REFRESH_TOKEN_SECRET` | *(recommended, separate)* | Refresh token JWT secret (7d tokens) |
| `JWT_SECRET` | *(legacy, optional)* | If set, applies to both access and refresh secrets when the specific ones are unset |
| `ADMIN_PASSWORD` | *(required in production)* | Admin bootstrap password (re-synced to DB on every boot, authoritative over UI-set passwords) |
| `INITIAL_CREDITS` | `100` | Credits for new users |
| `PUBLIC_BASE_URL` | — | Public base URL for project links |
| `AGENT_TYPE` | `none` | Agent mode: `main` / `sub` / `none` |
| `DOCKER_CONTAINER` | `0` | Set to `1` when running in Docker (also auto-detected via `/.dockerenv`) |

## API

### Auth (public + authenticated)
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login (rate-limited: 5 req/min per IP) |
| `POST` | `/api/auth/register` | Register (rate-limited: 5 req/min per IP) |
| `POST` | `/api/auth/refresh` | Refresh token rotation (rate-limited: 20 req/min per IP) |
| `GET` | `/api/auth/me` | Current user data |
| `POST` | `/api/auth/logout` | Logout |
| `POST` | `/api/auth/change-password` | Change password |
| `GET` | `/api/auth/credits/history` | Own credit history (paginated) |
| `PATCH` | `/api/auth/profile` | Update email |

### Chat + Core (authenticated, user-scoped)
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/chat` | Chat with agent (SSE, credit check before streaming, multi-turn context, auto-compact) |
| `POST` | `/api/chat/compact` | Manually compact conversation context for a session |
| `GET` | `/api/models` | Available models (enabled, with costPerStep) |
| `GET` | `/api/tasks?limit=&offset=` | List user's tasks (paginated, admin sees all) |
| `POST` | `/api/tasks` | Create task |
| `PATCH` | `/api/tasks/:id` | Update/cancel task (ownership verified) |
| `GET/PUT/DELETE/POST` | `/api/files/*` | File operations (path traversal protected, per-user) |
| `GET/PUT` | `/api/config` | Configuration (apiKey filtered for non-admins) |
| `GET/POST` | `/api/sessions?limit=&offset=` | Sessions (user-scoped, paginated) |
| `DELETE` | `/api/sessions/:id/messages` | Clear all messages in a session (ownership verified) |
| `GET/POST` | `/api/projects` | Projects (auto-creates session + folder) |

### Admin (auth + admin role)
| Method | Route | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List users |
| `POST` | `/api/admin/users/:id/credits` | Add credits (atomic operation) |
| `PATCH` | `/api/admin/users/:id/role` | Change role |
| `DELETE` | `/api/admin/users/:id` | Delete user |
| `GET` | `/api/admin/users/:id/credits/history` | Credit history (paginated) |
| `GET` | `/api/admin/stats` | Global statistics |
| `GET` | `/api/admin/models` | List all models with config |
| `PUT` | `/api/admin/models/:modelId` | Configure model (enabled, costPerStep, displayName) |
| `DELETE` | `/api/admin/models/:modelId` | Remove model config |
| `PATCH` | `/api/admin/models/batch` | Batch enable/disable models |
| `PATCH` | `/api/admin/users/:id` | Update user email |
| `POST` | `/api/admin/users/:id/reset-password` | Reset user password |
| `GET` | `/api/admin/node-processes` | List active Node.js processes |
| `POST` | `/api/admin/node-processes/:uuid/stop` | Stop Node.js process |
| `POST` | `/api/admin/node-processes/:uuid/restart` | Restart Node.js process |
| `GET` | `/api/admin/settings` | System settings (registration toggle) |
| `PATCH` | `/api/admin/settings` | Update settings |

### Orchestrator (authenticated, session-scoped)
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/orchestrator/start` | Start orchestrator session with objective (optional `sessionId`, `mdFiles`) |
| `POST` | `/api/orchestrator/:sessionId/stop` | Stop session (ownership verified) |
| `POST` | `/api/orchestrator/:sessionId/pause` | Pause session (ownership verified) |
| `POST` | `/api/orchestrator/:sessionId/resume` | Resume session (ownership verified) |
| `GET` | `/api/orchestrator/status` | Global singleton state (isRunning, currentSessionId, activeSessions list) |
| `GET` | `/api/orchestrator/:sessionId/status` | Session status (objective, progress, isRunning) — NB: ownership check not yet enforced, see security.md |
| `GET` | `/api/orchestrator/:sessionId/steps` | List orchestration steps (paginated) — NB: ownership check not yet enforced, see security.md |
| `GET` | `/api/orchestrator/:sessionId/tasks` | List planned tasks for session (ownership verified) |
| `POST` | `/api/orchestrator/:sessionId/upload-md` | Upload `.md` spec files (max 20, 10MB each; ownership verified) |

### Projects (public by UUID)
| Method | Route | Description |
|---|---|---|
| `GET` | `/p/<uuid>/*` | Serve published project (static, php, node) |

## Agent Tools

| Tool | Description | Approval if custom |
|---|---|---|
| `writeFile` | Create/edit files | — |
| `readFile` | Read files | — |
| `listFiles` | List directories | — |
| `deleteFile` | Remove files/dirs | Yes |
| `runCommand` | Shell commands (policy-filtered) | Yes |
| `executeCode` | JS/TS/Python | Yes |
| `searchFiles` | Search content (grep) | — |
| `webFetch` | HTTP GET (SSRF-protected) | — |
| `installPackage` | npm/pip install (execFile, no shell) | Yes |
| `invokeSubAgent` | Delegate sub-task to child agent (5 tools, max 30 steps) | — |

> **Note:** Default approval mode is `none` — all tools execute immediately. Change to `all` or `custom` in ConfigPanel to enable approval.

## Project Structure

```
web-agent/
├── src/                    # Backend TypeScript (ESM)
│   ├── server.ts           # Express + Socket.IO + auth bootstrap + project remount + orchestrator heartbeat start
│   ├── agent/              # ToolLoopAgent + 10 tools + provider + instructions
│   ├── orchestrator/       # Multi-agent autonomous workflow (manager, runner, heartbeat, agents/, prompts/)
│   ├── api/                # 10 REST routers (auth, admin, chat, models, tasks, files, config, sessions, projects, orchestrator)
│   ├── db/                 # Schema (14 tables + 7 indexes) + migration + 9 repositories
│   ├── middleware/          # Auth + Admin middleware
│   ├── lib/                # JWT utilities + workspace path resolution
│   ├── services/           # TaskManager, CreditManager, ApprovalManager, ProjectRouter, CompactionService, FileWatcher, ModelResolver, Logger
│   ├── preload/            # port-force.cjs (PORT monkey-patch for Node.js projects)
│   ├── types/              # Shared TypeScript types (single source of truth)
│   └── websocket/          # Socket.IO events (room-scoped, JWT-authenticated, ownership checks)
├── frontend/               # React 19 + Vite 8 + TailwindCSS 4
│   └── src/
│       ├── components/     # 17+ components + shadcn/ui primitives (incl. AutonomousPanel + Orchestrator* views)
│       ├── contexts/       # AuthContext (auth + socket singleton + authFetch)
│       ├── hooks/          # 8 hooks (useChat, useProjects, useFiles, useTasks, useSessions, useSocket, useResizable, useOrchestrator)
│       ├── lib/            # api.ts (authFetch-integrated), socket singleton, auth-api
│       └── types/          # Frontend type definitions
├── scripts/                # Build helper scripts (copy-preload.cjs)
├── apache/                 # Apache config (ports, vhost with -Indexes)
├── Dockerfile              # Multi-stage php:8.3-apache-bookworm (3 stages: frontend, backend, runtime)
├── docker-compose.yml      # Production Docker (requires JWT_SECRET/ACCESS_TOKEN_SECRET + ADMIN_PASSWORD)
├── .dockerignore           # Excludes logs and docs only — see security.md Known Limitations
├── CHANGELOG.md            # Detailed change history
└── security.md             # Security model, mitigations, and known limitations
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Backend with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript + copy preload script |
| `npm run start` | Run compiled backend |
| `npm run build:frontend` | Build frontend for production |
| `npm run dev:frontend` | Frontend dev server (port 5173) |

## Known Bugs (pending)

| Severity | Bug |
|---|---|
| Medium | `search-files` uses `grep` (doesn't work on Windows) |
| Medium | Approval flow doesn't pause agent execution (tool runs before approval arrives) |
| Low | Compaction token estimate is a rough heuristic (~4 chars/token, 60k threshold) — not model-specific |

## Fixed Bugs

See full details in [`CHANGELOG.md`](CHANGELOG.md).

| Severity | Bug | Fix |
|---|---|---|
| Critical | Credits never deducted | `mapRow()` didn't map `user_id`/`workspace_dir` |
| Critical | Agent wrote to global workspace | Same cause — fallback to `appConfig.workspaceDir` |
| Critical | Admin routes without role protection | `adminMiddleware` not applied |
| Critical | Credits not real-time | `creditManager.setIo()` never called |
| Critical | Project links broken (PHP/Node/Static) | PHP proxy without UUID→path mapping; dead pathRewrite; lost query strings |
| Critical | ERR_TOO_MANY_REDIRECTS on `/p/<uuid>/` | `subPath === ''` caused infinite redirect loop |
| Critical | Fetch monkey-patch caused stale closures | Replaced with `authFetch()` wrapper |
| Critical | JWT in download URLs (logged) | Authorization header-based downloads |
| High | Socket.IO singleton — 4 separate connections | Consolidated to singleton in `lib/socket.ts` |
| High | Config API leaked apiKey to all users | Filtered in response, `getPublic()` method |
| High | No authorization on tasks/sessions | Ownership verification for non-admins |
| High | TOCTOU race in credit deduction | Atomic `UPDATE WHERE credits >= ?` |
| High | No WebSocket auth | JWT verification on handshake + ownership checks |
| High | SSRF in webFetch (incomplete blocklist) | Added link-local, cloud metadata, octal/hex IPs, DNS resolution check |
| High | Zip Slip in file extraction | Manual entry validation with `safeWorkspacePath()` |
| High | Content-Disposition header injection | `sanitizeFilename()` strips CRLF and quotes |
| High | Command injection in installPackage | `execFile()` instead of `exec()` |
| Medium | Projects without index.html loaded SPA | `next()` in project-router hit catch-all |
| Medium | Mount failures left projects as "active" | Status updated in `catch` |
| Medium | Duplicate steps in `agent_steps` | Fixed insertion logic |
| Medium | Credits broadcast to all users | `io.emit()` → `io.to(user:ID).emit()` |
| Medium | AbortController didn't abort LLM call | `abortSignal.aborted` check in stream generator |
| Medium | Node.js ports never recycled | Port pool with `allocatePort()`/`releasePort()` |
| Medium | Node.js restart without backoff | Exponential backoff: 1s → 2s → 4s → 8s → 16s (cap 30s) |
| Medium | `isRunning` hardcoded false in Layout | Derived from `isStreaming` via callback |
| Medium | Mixed PT/EN in UI | Translated ApprovalDialog + useChat messages to EN |
| Medium | JSON.parse without try/catch | Wrapped in try/catch with undefined fallback |
| Medium | Stale closure in useChat.send | `messagesRef` pattern, `messages` removed from deps |
| Medium | Logger blocked event loop | `appendFileSync` → `createWriteStream` with cache |
| Medium | Missing DB indexes | 7 indexes added to schema + migration |
| Low | Apache directory listing enabled | `Options -Indexes FollowSymLinks` |
| Low | `addCredits()` read-modify-write race | Atomic `UPDATE SET credits = credits + ?` |
| Low | Duplicate `safePath` in files.ts | Imports `safeWorkspacePath` from sanitize.ts |
| Low | `@types/multer` in dependencies | Moved to devDependencies |
| Low | Duplicate `env_file` in docker-compose | Removed volume mount, kept `env_file` |
| Low | Missing `useCallback` in FileManager | 7 handlers wrapped in `useCallback` |
| Low | Duplicate types (UserPublic, CreditTransaction) | Import from `types/index.ts` |
| Low | Dead code: execution-sandbox.ts, unused shadcn | Deleted |
| Low | Incomplete `.gitignore` | Added `dist/`, `data/`, `*.log`, `*.db-wal`, `.env.local` |
| Low | Log message bug in chat API | `{ sessionId: model }` → `{ sessionId, model }` |
| Low | Fragile inline build script | Extracted to `scripts/copy-preload.cjs` |

## Schema — model_config Table

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Internal UUID |
| `model_id` | TEXT UNIQUE | Model ID (e.g. `z-ai/glm-5.2`) |
| `enabled` | INTEGER | 1=enabled, 0=disabled (default 1) |
| `cost_per_step` | REAL | Credits per step (default 1) |
| `display_name` | TEXT | Custom display name |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
