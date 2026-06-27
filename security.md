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
- **Production requires `JWT_SECRET`** — Server refuses to start in production without it
- **Production requires `ADMIN_PASSWORD`** — No default admin password in production
- **Rate limiting** — Login/register: 5 req/min per IP. Refresh: 20 req/min per IP
- **No JWT in URLs** — Downloads use Authorization header, no query-param token fallback
- **WebSocket authentication** — JWT verified on Socket.IO handshake; event handlers verify resource ownership via `socket.data.userId`
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

- **Docker** — `.dockerignore` excludes `node_modules`, `dist`, `data`, `.env`, `.git`, `workspace`, `*.db*`, `*.log`
- **Apache** — Directory listing disabled (`Options -Indexes FollowSymLinks`)
- **Async logging** — Logger uses `createWriteStream` in append mode, never `appendFileSync` (no event loop blocking)

## Known Limitations

| Severity | Issue | Status |
|---|---|---|
| **Medium** | `searchFiles` tool uses `grep` — doesn't work on Windows | Open |
| **Medium** | Approval flow doesn't pause agent execution — tool runs before approval arrives | Open |
| **Low** | Compaction sends conversation history to LLM for summarization — conversation data processed by LLM provider | Accepted (same provider as main agent) |
| **Low** | No content sanitization on files read by agent — workspace content could influence agent behavior | Accepted (agent prompt hardening only) |
| **Low** | `installPackage` can install arbitrary npm/pip packages with pre-install scripts | Accepted (no whitelist) |
| **Low** | `executeCode` tool and Node.js spawned projects inherit a subset of `process.env` | Mitigated (secrets removed from Node project env) |

## Agent Approval Modes

| Mode | Behavior |
|---|---|
| `none` (default) | All tools execute immediately |
| `all` | Every tool call requires user approval |
| `custom` | Only tools with `needsApproval: true` require approval (deleteFile, runCommand, executeCode, installPackage) |

> **Note:** The approval flow currently sends the request but does not block tool execution until the response arrives. This is a known limitation.

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Email the maintainer with details: affected component, attack vector, proof of concept
3. Include the version/commit you tested against
4. Allow reasonable time for a fix before public disclosure

## Security Checklist for Deployment

- [ ] `JWT_SECRET` set to a strong random value (≥32 chars)
- [ ] `ADMIN_PASSWORD` set to a strong password
- [ ] `API_KEY` kept secret (not committed to git)
- [ ] `.env` file not committed to version control
- [ ] Docker container not exposing unnecessary ports
- [ ] `PUBLIC_BASE_URL` set correctly for project links
- [ ] `NODE_ENV=production` set in deployment
- [ ] File permissions on `data/` directory restricted
