# Chat continuity and reliability audit

Reviewed the chat request lifecycle, AI SDK integration, persisted model context,
compaction, task status, cancellation, authentication refresh, model discovery,
orchestrator completion checks, session authorization, tools, and credit setup.

## Corrections

- Reject empty, truncated, abnormal and step-limited model finishes instead of
  treating a transport finish as successful task completion. Apply the same
  completion requirement to direct tasks, delegated agents and the orchestrator.
- Persist partial text, tool outcomes, created files and the latest cumulative
  SDK transcript on interruption. Checkpoint progress during completed tool steps.
  Continuation uses existing history without duplicating earlier tool calls.
- Preserve provider-specific transcript metadata needed for subsequent turns.
- Bound stalled chat steps and streaming gaps. Preserve SDK request retries, which
  retry inference requests without replaying previously completed chat tools.
- Keep cancellation terminal, release pending approvals on abort, and pass abort
  signals through command, code execution and package installation tools.
- Prevent concurrent chat requests from interleaving a session's history and
  prevent clearing or deleting a session while its task is active.
- Preserve six recent turns during compaction. A failed summary leaves original
  history intact. Commit the summary and exact snapshot atomically and reject a
  stale snapshot. Clearing history also clears the previous summary.
- Prevent old chat streams/history requests from updating a different session.
- Share authentication refresh between concurrent requests, update token refs
  synchronously, preserve login during temporary refresh outages, and prevent
  delayed refresh from signing a logged-out user back in.
- Enforce ownership for orphan sessions/tasks and task socket subscriptions.
- Send model discovery credentials, scope its cache by endpoint and credential,
  validate HTTP responses, and stop rejecting chat models against fallback lists.
- Create the initial chat workspace before file operations. Persist task ownership
  atomically and reject attempts to rerun a non-pending task.
- Mark interrupted tasks failed on server startup instead of leaving them running.
- Grant initial user and administrator credits once, rather than twice.
- Use unique temporary execution filenames and accurately display failed tools.

## Validation and limits

Regression tests exercise the real Express router, in-memory SQLite, AI SDK and
file-writing tools with a simulated provider. They cover HTTP and streaming errors,
truncation, empty responses, tool progress after failure, continuation, duplicate
transcripts, step exhaustion, compaction success/failure, context metadata, history
clearing, ownership, concurrency, cancellation, approvals and initial credits.

Run `npm test`, `npm run build`, `npm run build:frontend`, and
`npx tsc --noEmit -p frontend/tsconfig.json`.

Validation result: 17 regression tests passed; both production builds and the
frontend TypeScript check passed. The frontend build reports existing large
JavaScript bundles as a performance warning.

Provider failures after retries leave the task failed with saved progress. Once the
provider is available, send a continuation message in the same chat. Restart recovery
retains checkpoints and files; it does not silently restart an interrupted task.
Successful model termination does not independently prove the quality of generated
code: the agent must still verify the requested changes. Live provider behavior,
deployment, payment services and OnlyOffice were not exercised against external
accounts as part of these regression tests.
