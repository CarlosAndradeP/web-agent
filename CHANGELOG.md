# Changelog

All notable changes to the Web Agent project.

## [2026-07-02] — Security, Stability, Orchestrator, Hardening (PRs 1–5)

Multi-area hardening pass based on a deep code + docs audit. Five focused PRs, one per area. JWT refresh now uses a separate secret, which invalidates all existing tokens on deploy (forces re-login).

### PR 1 — Backend Security & Auth Critical
- **JWT hardening** (`src/lib/jwt.ts`, `src/config.ts`) — `signAccessToken`/`signRefreshToken` emit a `type: 'access'|'refresh'` claim; `verifyToken` rejects refresh tokens; `verifyRefreshToken` uses a separate `REFRESH_TOKEN_SECRET` (falls back to legacy `JWT_SECRET`). Rotating secrets forces logout for all users.
- **Auth API** (`src/api/auth.ts`) — refresh endpoint uses `verifyRefreshToken`; bcrypt cost loop capped at 20; expired auth-session pruning on each login.
- **Chat IDOR + role validation** (`src/api/chat.ts`) — `effectiveSessionId` ownership-validated; message roles restricted to `user|assistant|tool`; default-session dedup uses `s.userId` (not `(s as any).user_id`); swallowed `catch {}` replaced with logged errors.
- **Atomic credit operations** (`src/db/repositories/credits.ts`) — `deduct` and `add` wrapped in `db.transaction`; `add` uses `credits = credits + ?` (atomic, no read-modify-write race).
- **Approval deny-by-default** (`src/services/approval-manager.ts`) — when `entry.userId === undefined`, approvals are rejected unless an explicit admin bypass is provided.
- **Tasks ownership + cancel race** (`src/api/tasks.ts`, `src/services/task-manager.ts`) — `createTask` receives `userId`; session ownership validated; `cancelTask` emits events before deleting `taskUserMaps`; stream marks status `'cancelled'` (not `'completed'`) on abort.
- **Sessions/projects ownership in transactions** — deletions run inside transactions; `project_id = null` bug fixed; swallowed catches logged.
- **DB init** (`src/db/index.ts`) — `import` over `require` for `node:fs`; `busy_timeout = 5000` pragma added.

### PR 2 — Backend Stability
- **Rate limiter eviction** (`src/server.ts`) — in-memory Map capped at 10k keys with FIFO eviction; `req.ip` fallback chain (`req.socket?.remoteAddress`); shared `gracefulShutdown` handler for SIGTERM and SIGINT.
- **Project router** (`src/services/project-router.ts`) — `promoteToNode` uses `allocatePort()` (port-recycler pool) instead of an ever-incrementing counter; `createRequire(import.meta.url)` for loading project `package.json` (works with ESM); `restartTimer` tracked on `ActiveProject` and cleared on unmount/stop/shutdown (no zombie timers).
- **File watcher rooms** (`src/services/file-watcher.ts`) — `file:changed` and `project:node-detected` emitted to `user:<userId>` rooms (aligned with the rooms clients actually join); `UsersRepository` injected.
- **Archiver error handler** (`src/api/files.ts`) — `archive.on('error', ...)` prevents an unhandled stream error from crashing the process.

### PR 3 — Orchestrator Critical
- **Resume state reset** (`orchestrator-runner.ts`) — `resume()` now resets `totalStepsUsed`, `taskRetryCount`, and `replanCount` (previously leaked across runs, causing stale retry/step limits).
- **Replan suggestions** — `parseReplanSuggestions` accepts `'revisor'` as a valid role (was excluded, blocking replan that included reviewer tasks).
- **Timeout classification** — `classifyError` now marks timeouts as `transient` (was `permanent`, blocking retry of network timeouts).
- **`verifyProject` no longer assumes pass on empty/exception** — empty verification text and caught exceptions return `false` (fail-closed) instead of assuming success.
- **Per-model credit billing** — `SubAgentResult` carries `modelUsed`; `deductCreditsForTask` uses the actual fallback model's cost instead of always charging the primary (more expensive) model.

### PR 4 — Backend Hardening
- **Command policy** (`command-policy.ts`) — regex patterns anchored with `\b` to avoid false-positive substring matches (e.g. `mkfifo` no longer matches `mkfifoX`).
- **Path traversal defense-in-depth** (`sanitize.ts`) — `path.relative()` check rejects drive changes and `..` sequences uniformly (catches Windows cross-drive escapes).
- **SSRF rebinding mitigation** (`web-fetch.ts`) — re-resolve DNS immediately before `fetch()` and reject if the resolved IP is private/internal (narrows the TOCTOU window).
- **execute-code path quoting** (`execute-code.ts`) — file paths quoted in the shell command (supports paths with spaces).
- **Logger stream prune** (`logger.ts`) — periodic eviction of stale `WriteStream` entries from `streamCache` (every hour; streams older than 2 days closed/removed).
- **Compaction summary preservation** (`compaction-service.ts`) — `compactSession` includes the previous summary in the summarization input, so multi-compaction builds on prior context instead of discarding it.
- **Model cache invalidation** (`model-resolver.ts`, `api/config.ts`) — exported `invalidateModelCache()`; the config PUT endpoint invalidates the cache after `configRepo.updateAll()` so the next request refetches from the new endpoint.

### PR 5 — Frontend Hardening
- **Chat stream abort** (`api.ts`, `useChat.ts`) — `api.chat.stream` accepts an `AbortSignal`; `useChat` passes the local `AbortController` signal so a cancel actually aborts the fetch (not just the reader).
- **Socket re-auth on token refresh** (`AuthContext.tsx`) — the Socket.IO connection now depends on `accessToken`; a refresh triggers reconnect with the new token (the previous token expired after 15 min with no re-auth).
- **Authenticated upload** (`FileManager.tsx`) — file upload uses `authFetch` (auto Authorization header + 401 refresh) instead of a raw `fetch` with a manual header.
- **Stable list keys** (`OrchestratorLog.tsx`) — step/log entries keyed by stable IDs (`id`/`stepNumber`/`timestamp`) instead of the array index, avoiding reconciliation bugs on reorder/insert.

## [2025-06-27-b] — Chat Compaction, Slash Commands, Force Stop, File Attach

### Feature 1: Chat Context Compaction (Multi-turn + Auto-compact)

Previously the agent was completely stateless — every invocation received only the last user message as the prompt, with zero conversation history. Now the full multi-turn conversation is passed to the LLM, and context is automatically compacted when it exceeds the token threshold.

- **Multi-turn conversation history** — `POST /api/chat` now persists incoming messages to DB, then builds the full `ModelMessage[]` (including any prior summary) via `CompactionService.getConversationContext()` and passes it to `TaskManager.createTask()` → `createAgent()`. Agent calls use `messages: ModelMessage[]` instead of `prompt: string`.
- **Auto-compaction** — Before creating a task, `compactionService.autoCompactIfNeeded()` estimates token count from total content length (~4 chars/token heuristic, 60k default threshold). If exceeded, calls the LLM with a summarization prompt, generates a concise summary, then marks old messages as compacted (`is_compacted = 1`) and stores the summary.
- **`CompactionService`** (new file `src/services/compaction-service.ts`) — Core methods:
  - `needsCompaction(sessionId, model?)` — estimates tokens from total content length, returns true if above threshold
  - `compactSession(sessionId)` — loads messages, calls LLM for summary, stores via repo. Falls back to head/tail truncation if LLM fails
  - `autoCompactIfNeeded(sessionId, model?)` — auto-compact check + execution
  - `getConversationContext(sessionId)` — builds `ModelMessage[]` from prior summary + active (non-compacted) messages
- **Database changes** — `is_compacted INTEGER DEFAULT 0` column on `messages` table; `summary_text TEXT DEFAULT NULL` column on `sessions` table. Migrations for existing DBs in `migrate.ts`.
- **MessagesRepository** — `findBySession()` filters `is_compacted = 0` by default (opt-in `includeCompacted` flag). New methods: `compactSession()` (transactional: inserts summary + marks old messages), `deleteBySession()`, `countActive()`, `totalContentLength()`.
- **SessionsRepository** — New methods: `updateSummary(sessionId, summaryText)`, `getSummary(sessionId)`.
- **API endpoint** — `POST /api/chat/compact` (ownership-verified) triggers manual compaction. Returns `{ success, summary }`.
- **Frontend** — New `api.chat.compact(sessionId)` and `api.sessions.clearMessages(id)` API methods. `/compact` slash command triggers compaction and displays result summary.

### Feature 2: Slash Commands

Chat input now parses `/` prefixes as commands. Autocomplete dropdown with keyboard navigation.

- **6 commands implemented:**
  - `/clear` — Clears all messages in current session (calls `DELETE /api/sessions/:id/messages` + resets local state)
  - `/new` — Creates a new session via `onNewSession` callback from Layout
  - `/compact` — Triggers context compaction via `POST /api/chat/compact`, shows result
  - `/help` — Displays all available commands with usage info
  - `/model <name>` — Switches model in dropdown (partial match supported)
  - `/steps <N>` — Sets custom max steps (1–200) for subsequent agent runs
- **Autocomplete dropdown** — Appears when input starts with `/`. Arrow keys to navigate, Tab/Enter to select, Escape to dismiss. Filters commands as user types.
- **`useChat` additions** — `addSystemMessage(content)` for command feedback, `clearChat()` that clears local state + calls server to delete messages.
- **Backend endpoint** — `DELETE /api/sessions/:id/messages` verifies ownership, calls `messagesRepo.deleteBySession()`, returns `{ success, deleted }`.

### Feature 3: Force Stop Agent

The stop button now kills the running agent on the server, not just the client stream.

- **`activeTaskIdRef`** in `useChat` — Tracks the server-side task ID from the SSE `task-start` event.
- **Rewritten `cancel()`** — First calls `api.tasks.cancel(activeTaskIdRef.current)` to abort the server-side `AbortController` (which stops the LLM call), then aborts the local stream reader. Server cancels task via `taskManager.cancelTask()` → `abortController.abort()`.
- **Prevents resource waste** — Previously the agent continued running on the server even after the client disconnected. Now the agent is properly stopped.

### Feature 4: File Attach Functionality

The 📎 (Paperclip) button and drag-and-drop are now functional for uploading files to the workspace.

- **File picker** — Hidden `<input type="file" multiple>` triggered by Paperclip button click. Files uploaded via `api.files.upload()` to the project workspace.
- **Attached files preview** — Uploaded files shown as removable pills above the input field with filename and ✕ button.
- **Agent notification** — When a message is sent with attached files, the content is prepended with: `[The user uploaded these files to the workspace: /path/file1, /path/file2. They may reference them in their message.]\n\n{user message}`. The agent can then use `readFile` to inspect the files.
- **Drag and drop** — Messages area accepts file drops. Shows blue dashed overlay with "Drop files to upload" indicator. Files uploaded on drop.
- **Upload spinner** — Paperclip icon replaced with spinner during upload.
- **New ChatPanel props** — `onNewSession?: () => void` (for `/new` command), `basePath?: string` (for upload destination, from `activeProject?.folderPath` in Layout).

---

## [2025-06-27] — Security & Stability Audit

Comprehensive security audit and fixes across 4 phases: critical security, high-priority stability, medium-priority fixes, and quality cleanup.

### Phase 1: Critical Security Fixes

- **JWT_SECRET & ADMIN_PASSWORD required in production** — Removed insecure fallback defaults. Server refuses to start with `NODE_ENV=production` without them. Dev mode uses fallbacks with warning. Updated Dockerfile and docker-compose.yml.
- **Config API apiKey leak** — `GET /api/config/` no longer returns `apiKey` to non-admin users. Added `getPublic()` method in ConfigRepository.
- **Authorization on tasks/sessions** — Non-admin users can only access their own tasks and sessions. Ownership verified in `GET /:id`, `PATCH /:id`, `DELETE /:id`, and `GET /:id/messages`. Admin bypass preserved.
- **TOCTOU race in credit deduction** — `deduct()` in CreditsRepository now uses atomic `UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?` with `changes` count check. No read-modify-write race.
- **WebSocket authentication** — Added `io.use()` middleware that validates JWT on handshake (`socket.auth.token`). Event handlers (`approval:respond`, `task:cancel`) verify `socket.data.userId` matches resource owner. Frontend passes `{ auth: { token } }` in all socket connections.
- **SSRF protection enhanced** — `webFetch` tool now blocks: link-local (`169.254.*`), `0.0.0.0`, `[::1]`, octal IPs (`0177.0.0.1`), hex IPs (`0x7f000001`), decimal IPs, IPv6-mapped addresses, cloud metadata (`169.254.169.254`). Post-DNS resolution check via `dns.promises.resolve4/resolve6`.
- **Zip Slip protection** — `extract-zip` endpoint no longer uses `extractAllTo()`. Iterates entries manually, validates each path with `safeWorkspacePath()`, extracts individually.
- **Content-Disposition header injection** — New `sanitizeFilename()` strips quotes, CRLF, and special characters before setting `Content-Disposition` header.
- **Command injection in installPackage** — Replaced `exec()` with `execFile()` using argument array. Eliminates shell interpretation of package names.

### Phase 2: High-Priority Fixes

- **Replaced fetch monkey-patch with authFetch wrapper** — Removed `window.fetch` re-patching from AuthContext. Created `authFetch()` that reads tokens from refs (always current), adds Authorization header inline, and retries 401 with transparent refresh. Registered with `api.ts` via `setAuthFetch()`.
- **Consolidated Socket.IO connections** — 4 separate `io()` calls reduced to one singleton in `lib/socket.ts`. `AuthContext` owns connection lifecycle (`connectWithAuth`/`disconnectSocket`). `useSocket` and `useProjects` read via `getSocket()`. `useSocket` no longer calls `connectWithAuth`.
- **Rate limiting on auth endpoints** — Login/register: 5 req/min per IP. Refresh: 20 req/min per IP. Implemented with in-memory Map in `server.ts`.
- **Removed JWT from download URLs** — Downloads use `fetch` with Authorization header + blob programmatic download. No query-param token fallback. Auth middleware no longer accepts `?token=` param.
- **Pagination on list endpoints** — `GET /api/tasks` and `GET /api/sessions` accept `limit` (default 50, max 200) and `offset` query params. Response includes `total`, `limit`, `offset`. Frontend API client updated.
- **Logger uses async write streams** — Replaced `appendFileSync` with `createWriteStream` in append mode. Streams cached per log file and flushed on `process.on('exit')`. No more event loop blocking.
- **Removed dead code** — Deleted `src/services/execution-sandbox.ts` (never imported).

### Phase 3: Medium-Priority Fixes

- **AbortController in stream generator** — Added `if (abortSignal?.aborted) break;` check in `eventStream()` generator between chunks, so cancelled tasks exit immediately.
- **Node.js port recycling** — New `allocatePort()`/`releasePort()` system. Ports returned to pool on `stopProject()` and `unmountProject()`. Range: 9000–65535 with overflow wrap.
- **Node.js exponential backoff** — Restart delay: `min(1000 * 2^(restartCount-1), 30000)`. Crash loop now takes ~30s instead of 5s for 5 restarts.
- **isRunning derived from streaming state** — `Layout` now receives `isStreaming` from `ChatPanel` via `onStreamingChange` callback. No more hardcoded `isRunning: false`.
- **UI language consistency** — Translated all PT strings to EN in `ApprovalDialog` (labels, buttons, descriptions) and `useChat` ("Credits exhausted" message).
- **JSON.parse safety in useChat** — `JSON.parse(m.toolCalls)` wrapped in try/catch with `undefined` fallback. Prevents crash on malformed data.
- **Stale closure fix in useChat** — Added `messagesRef` to always read latest state. Removed `messages` from `send` callback dependencies. Eliminates stale message list in rapid sends.
- **Database indexes** — Added 7 indexes: `sessions(user_id)`, `tasks(user_id)`, `tasks(session_id)`, `messages(session_id)`, `credit_transactions(user_id)`, `projects(user_id)`, `auth_sessions(user_id)`. Applied in both `schema.ts` (new DBs) and `migrate.ts` (existing DBs).
- **Docker .dockerignore** — Created with exclusions for `node_modules`, `dist`, `data`, `.env`, `.git`, `workspace`, `*.db*`, `*.log`.
- **Apache directory listing disabled** — Changed `Options Indexes FollowSymLinks` to `Options -Indexes FollowSymLinks`.
- **Atomic addCredits** — `addCredits()` now uses `UPDATE users SET credits = credits + ?` instead of read-modify-write. Eliminates race condition on concurrent additions.

### Phase 4: Quality & Cleanup

- **Deduplicated safePath** — Removed local `safePath` from `api/files.ts`. Both API and agent tools now use `safeWorkspacePath()` from `agent/tools/sanitize.ts`.
- **Package cleanup** — Moved `@types/multer` from `dependencies` to `devDependencies`.
- **Removed duplicate .env mount** — `docker-compose.yml` no longer mounts `./.env:/app/.env:ro` (redundant with `env_file: .env`).
- **useCallback in FileManager** — 7 inline handlers (`handleSelect`, `handleDownload`, `handleDownloadZip`, `handleDelete`, `handleRename`, `handleCreate`, `handleSave`) wrapped in `useCallback` with proper dependency arrays.
- **Type deduplication** — `UserPublic` and `CreditTransaction` now imported from `types/index.ts` in their respective repositories, instead of being redefined locally.
- **Updated .gitignore** — Added `dist/`, `data/`, `*.log`, `*.db-wal`, `*.db-shm`, `.env.local`.
- **Removed unused shadcn components** — Deleted `card.tsx`, `textarea.tsx`, `tooltip.tsx` (never imported anywhere).
- **Fixed log message typo** — `chat.ts`: `{ sessionId: model }` → `{ sessionId, model }`.
- **Extracted build script** — Inline Node one-liner in `package.json` extracted to `scripts/copy-preload.cjs`. Build script now `tsc && node scripts/copy-preload.cjs`.

### Pre-Audit Fixes (prior sessions)

- Credits never deducted (mapRow didn't map user_id/workspace_dir)
- Agent wrote to global workspace (same cause)
- Admin routes without role protection (adminMiddleware not applied)
- Credits not real-time (creditManager.setIo() never called)
- Project links broken (PHP proxy, pathRewrite, query strings)
- ERR_TOO_MANY_REDIRECTS on /p/<uuid>/
- Projects without index.html loaded SPA
- Mount failures left projects as "active"
- Duplicate steps in agent_steps
- Credits broadcast to all users (io.emit → io.to(user:ID).emit)
- localStorage credit sync
- Approval dialog showing raw JSON
- Approval mode default changed from "custom" to "none"
