# Security Model — Web Agent

## Overview

Web Agent is a multi-user platform where an autonomous AI agent executes code and file operations on behalf of users. This document describes the security architecture, mitigations in place, known limitations, and reporting guidelines.

## Threat Model

| Actor | Capability | Mitigated? |
|---|---|---|
| Malicious user (agent operator) | Uses agent tools to escape workspace, access other users' data, or attack the host | Partially — see per-mitigation status below |
| Cross-user attack | User A accesses User B's workspace, sessions, tasks, or credits | Yes — workspace isolation + API authorization |
| External attacker (unauthenticated) | Hits public endpoints, tries brute-force login, exploits SSRF via agent | Yes — auth middleware, rate limiting, SSRF protection |
| Prompt injection via workspace content | Malicious files in workspace trick agent into executing unintended actions | Partially — system prompt hardening, no content filtering |

## Mitigations

### Authentication & Authorization

- **JWT with access/refresh tokens** — Access token 15min, refresh token 7d with rotation
- **Separate secrets** — `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` are recommended (the legacy `JWT_SECRET` env maps to both for backward compatibility). Rotating either secret forces logout for the corresponding token type
- **Production requires secrets** — Server refuses to start in production without both `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET` (or `JWT_SECRET`) and `ADMIN_PASSWORD`
- **Admin password authoritative** — On every boot the persisted admin password hash is re-synced to match the `ADMIN_PASSWORD` env value (changes via UI are reverted on restart; manage the secret via env/secrets, not the UI)
- **Rate limiting** — Login/register: 5 req/min per IP. Refresh: 20 req/min per IP. In-memory limiter with 10k-key FIFO eviction cap; per-replica only (single-container deploy)
- **No JWT in URLs** — HTTP downloads use Authorization header, no query-param token fallback for HTTP
- **WebSocket authentication** — JWT verified on Socket.IO handshake; event handlers verify resource ownership via `socket.data.userId`. NB: socket handshake also accepts `socket.handshake.query.token` as a fallback to `auth.token` (see Known Limitations)
- **API authorization** — Non-admin users can only access their own tasks, sessions, and resources. Admin bypass preserved for management endpoints
- **Config API** — `GET /api/config/` filters `apiKey` for non-admin users

### Workspace Isolation

- **Per-user workspaces** — Each user operates in `workspace/<username>/`
- **Path traversal protection** — `safeWorkspacePath()` (in `src/agent/tools/sanitize.ts`) validates all file paths in both agent tools and file API. Resolves `../` sequences and rejects paths outside the workspace
- **Single source of truth** — Both `api/files.ts` and agent tools import `safeWorkspacePath` from `sanitize.ts` — no duplicate implementations
- **Agent scoped to project** — Agent operates within the active project subfolder, not the user's root workspace

### Agent Tool Security

- **Command policy** — `runCommand` tool blocks dangerous patterns via `command-policy.ts`: `rm -rf /`, reading secrets (`.env`, `.key`, `.pem`), exfiltration via `curl`/`wget` with shell expansion, `env`/`printenv`, reverse shells, direct DB access
- **SSRF protection** — `webFetch` blocks: `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, link-local (`169.254.*`), cloud metadata (`169.254.169.254`), private IP ranges, octal IPs (`0177.0.0.1`), hex IPs (`0x7f000001`), decimal IPs, IPv6-mapped addresses. Post-DNS resolution check via `dns.promises.resolve4/resolve6`
- **No shell interpolation** — `installPackage` uses `execFile()` with argument array instead of `exec()` — eliminates shell injection via package names
- **Zip Slip protection** — ZIP extraction iterates entries manually, validates each path with `safeWorkspacePath()` before extracting (no `extractAllTo()`)
- **Content-Disposition injection** — `sanitizeFilename()` strips quotes, CRLF, and special characters

### Credit System

- **Atomic deduction** — `deduct()` uses `UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?` with `changes` count check. No read-modify-write race (TOCTOU eliminated)
- **Atomic addition** — `addCredits()` uses `UPDATE users SET credits = credits + ?`
- **Pre-task credit check** — Chat endpoint returns 402 if user has zero credits before streaming starts
- **Real-time updates** — Credit changes broadcast via Socket.IO to user-specific rooms (`io.to('user:ID').emit()`), never global broadcast

### Database

- **WAL mode** — SQLite in WAL mode for concurrent read/write
- **Foreign keys with CASCADE** — Orphaned records cleaned automatically
- **Indexes** — 7 indexes on `user_id` and `session_id` columns for query performance and to prevent full-table scans

### Infrastructure

- **Docker** — Multi-stage `Dockerfile` (frontend + backend + runtime) on `php:8.3-apache-bookworm`. **`.dockerignore` currently excludes only `*.log`, `README.md`, `CLAUDE.md`, `.claude`** — see Known Limitations for the gap this creates
- **Apache** — Directory listing disabled (`Options -Indexes FollowSymLinks`), `ProxyRequests Off` (no forward proxying)
- **Async logging** — Logger uses `createWriteStream` in append mode, never `appendFileSync` (no event loop blocking). No log rotation (one file per day, unbounded)
- **Graceful shutdown** — `SIGINT`/`SIGTERM` handler closes DB WAL, kills Node.js project subprocesses, releases ports, unmounts symlinks, shuts down heartbeat and orchestrator runners
- **Production fail-fast** — `config.ts` calls `process.exit(1)` if any required secret is missing under `NODE_ENV=production`
- **HTTP headers — NOT hardened** — No `helmet` dependency, no `Content-Security-Policy`, no `X-Frame-Options`, no `X-Content-Type-Options`, no `Strict-Transport-Security`, no `Referrer-Policy`. `express.json()` has no explicit body-size limit. `cors()` and Socket.IO `cors: { origin: '*' }` accept any origin — see Known Limitations

## Known Limitations

| Severity | Issue | Status |
|---|---|---|
| **High** | Orchestrator IDOR — `GET /api/orchestrator/:sessionId/steps` and `GET /:sessionId/status` lack ownership checks; any authenticated user can read another user's orchestrator objective/plan/code by session ID | Open — see Orchestrator Limitations below |
| **High** | Orchestrator session hijack — `POST /api/orchestrator/start` does not verify the parent `sessionId` belongs to the caller | Open |
| **High** | Orchestrator sub-agents bypass ApprovalManager — `programador`/`auxiliar`/`arquiteto`/`revisor` toolsets are constructed without `buildToolSet`/`ApprovalManager`, so they run `writeFile`/`runCommand`/`executeCode`/`installPackage` without human approval regardless of the global `approvalMode` setting | Open |
| **High** | `spawnNodeProject` runs `npm start` from an attacker-writable `package.json` — an agent task can `writeFile` a malicious `start` script and the next "start project" executes it with no command-policy filtering | Open |
| **High** | **`.dockerignore` is thin** — excludes only `*.log`, `README.md`, `CLAUDE.md`, `.claude`. The full repo (incl. `node_modules/`, `dist/`, `data/`, `.git/`, and a reachable `.env` if present) is sent as build context. Slower builds and a secret-leak surface if any `COPY .` is ever added | Open |
| **High** | No HTTP-layer hardening — wide-open `cors()` and Socket.IO `cors: { origin: '*' }`, no `helmet`/CSP/X-Frame/X-Content-Type/HSTS headers, no `express.json` body-size limit | Open (JWT-in-Authorization-header and no cookies mitigate CSRF, but any web origin can read API responses via JS-fetch) |
| **High** | No tests, no linter, no CI — a code-execution platform with 10 agent tools has zero automated coverage. Security-critical code (`sanitize.ts`, `command-policy.ts`, `web-fetch.ts` IP blocklist, `credit` transactions) ships without regression protection | Open |
| **Medium** | Orchestrator `search-files` denylist on `runCommand`/`executeCode` — `execAsync` (with shell) is used; the `command-policy.ts` regex denylist is bypassable (e.g. `rm -fr  /tmp/../`, `dd of=/etc/passwd`, fork bombs) | Open |
| **Medium** | `printf`/`createWriteStream` in `executeCode` uses predictable path `exec-${Date.now()}.${ext}` — same-millisecond collisions and shell interpolation through the quoted path | Open |
| **Medium** | Execute-then-bill credit model — both `TaskManager` and the orchestrator run the tool **before** deducting credits; a user with 1 credit gets 1 free step (potentially harmful: `writeFile` of malicious code, `runCommand`). No pre-flight reserve | Open |
| **Medium** | No input validation in API routers — `zod` is a dependency but used only in agent tools. Negative `amount` in `POST /api/admin/users/:id/credits` could deduct credits via the "add" endpoint; `objective` in `POST /api/orchestrator/start` has no length cap | Open |
| **Medium** | `uncaughtException`/`unhandledRejection` log-and-continue — `server.ts:271-277` logs the error but keeps the process alive (anti-pattern per Node docs; state may be corrupted) | Open |
| **Medium** | Build artifacts and SQLite WAL files committed in git — `dist/` (213 files), `frontend/dist/`, `data/web-agent.db-shm`, `data/web-agent.db-wal`, `data/logs/*.log` were committed before `.gitignore` and remain tracked. `dist/services/execution-sandbox.js` is a deleted-source leftover | Open (hygiene; potential PII leak if WAL files contain user data in a public repo) |
| **Medium** | `JWT_SECRET` length not enforced — `security.md` recommends ≥32 chars but `config.ts` accepts any non-empty string | Open |
| **Medium** | `searchFiles` tool uses `grep` — doesn't work on Windows | Open |
| **Medium** | Approval flow doesn't pause agent execution — tool runs before approval arrives | Open |
| **Low** | WebSocket query-token fallback — `socket.handshake.auth.token ?? socket.handshake.query.token` accepts token via query params (leaks into access logs, browser history) — contradicts the HTTP "no query-param token" policy | Open |
| **Low** | `change-password` doesn't invalidate existing refresh sessions — an attacker with an existing refresh token retains access after the victim changes their password | Open |
| **Low** | Compaction sends conversation history to LLM for summarization — conversation data processed by LLM provider | Accepted (same provider as main agent) |
| **Low** | No content sanitization on files read by agent — workspace content could influence agent behavior | Accepted (agent prompt hardening only) |
| **Low** | `installPackage` can install arbitrary npm/pip packages with pre-install scripts | Accepted (no whitelist) |
| **Low** | `executeCode` tool and Node.js spawned projects inherit a subset of `process.env` | Mitigated (secrets removed from Node project env) |
| **Low** | Admin password re-sync overwrites UI changes on next restart — documented inline but may surprise operators who change the password via the UI | Accepted (env is canonical) |
| **Low** | No index on `agent_steps.task_id` — `GET /api/tasks/:id/steps` is a full scan | Open |
| **Low** | Orchestrator recovery resumes `running` sessions on startup with no staleness check on the session itself — a 3-day-old session gets resumed as if paused 3 days ago | Open |
| **Low** | Compaction token estimate is a rough heuristic (~4 chars/token, 60k threshold) — not model-specific | Accepted |

## Orchestrator Limitations (detail)

The orchestrator subsystem is a newer addition relative to the chat agent and inherits a thinner security layer:

- **Per-event auth is inconsistent across endpoints.** `:stop`, `:pause`, `:resume`, `:tasks`, `:upload-md` enforce `isAdminOrOwner`. `:start` only checks the parent `sessionId` exists (not ownership). `GET /:sessionId/status`, `GET /:sessionId/steps`, and `GET /status` perform **no** ownership check — they leak the session objective, plan prompts, task inputs/outputs, and the global `currentSessionId` to any authenticated user.
- **Sub-agents are not approval-wrapped.** The four agent factories in `src/orchestrator/agents/*.ts` construct their toolsets with `createXTool(workspaceDir)` directly, skipping `buildToolSet`. If a deployment sets `approvalMode: 'all'` for the chat agent's safety, the orchestrator's `programador`/`auxiliar` sub-agents still execute `writeFile`/`deleteFile`/`runCommand`/`executeCode`/`installPackage` without human review.
- **`MAX_PARALLEL_TASKS = 1`** despite the planner being prompted to "group independent tasks for parallelism" — execution is strictly serial. The `Promise.allSettled` over `batch` always has `batch.length === 1` (dead code or unfinished feature).
- **Hardcoded model IDs** (`z-ai/glm-5.2`, fallback `openai/gpt-oss-120b`) ignoring the admin-configured `model_config` enabled flag — if the admin disables `z-ai/glm-5.2`, the orchestrator still uses it.
- **`verifyProject` parses PASS/FAIL from free-text LLM output** — `"the implementation FAILS to..."` would set `hasFail=true` and fail verification even if the implementation is correct.

## Agent Approval Modes

| Mode | Behavior |
|---|---|
| `none` (default) | All tools execute immediately |
| `all` | Every tool call requires user approval |
| `custom` | Only tools with `needsApproval: true` require approval (deleteFile, runCommand, executeCode, installPackage) |

> **Note:** The approval flow currently sends the request but does not block tool execution until the response arrives. This is a known limitation. It does **not** apply to orchestrator sub-agents (those bypass approval entirely — see above).

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Email the maintainer with details: affected component, attack vector, proof of concept
3. Include the version/commit you tested against
4. Allow reasonable time for a fix before public disclosure

## Security Checklist for Deployment

- [ ] `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` set to strong random values (≥32 chars each). `JWT_SECRET` is accepted as a legacy fallback mapping to both
- [ ] `ADMIN_PASSWORD` set to a strong password (and not subsequently edited via the UI — env is authoritative on restart)
- [ ] `API_KEY` kept secret (not committed to git)
- [ ] `.env` file not committed to version control (`data/web-agent.db-*`, `dist/`, `data/logs/*.log` are tracked in git today — verify before public release)
- [ ] Docker container not exposing unnecessary ports
- [ ] `PUBLIC_BASE_URL` set correctly for project links
- [ ] `NODE_ENV=production` set in deployment (enables secret fail-fast)
- [ ] File permissions on `data/` directory restricted
- [ ] Consider adding `helmet` + a restrictive `cors({ origin: [...] })` allowlist and a CSP headermeta tag — current default is permissive (see Known Limitations)
