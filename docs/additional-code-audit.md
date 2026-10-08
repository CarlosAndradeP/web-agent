# Additional code audit

Date: 2026-10-08

This follow-up audit covers authentication, credits, orchestrator lifecycle, project processes/proxying and frontend socket subscriptions. It builds on the chat-continuity fixes documented separately.

## Validated defects and corrections

- Refresh JWTs issued within one second were identical. Tokens now have random JWT IDs.
- Bcrypt refresh hashes compared only the first 72 bytes of JWTs, allowing a consumed token to match another login session. Refresh tokens now use exact SHA-256 digests and atomic rotation. Storage failures return a retryable HTTP 500 rather than an authentication rejection.
- A startup migration overwrote explicitly configured custom approvals. It now preserves this setting.
- Daily bonuses could partially commit and advance their checkpoint after a failed grant. Grants and the checkpoint now commit in one transaction; notifications follow commit, and scheduled failures are logged for retry.
- Negative or fractional credit deductions could corrupt balances. Repository operations now validate safe integer amounts.
- Project shutdown treated a successfully sent SIGTERM as process exit, preventing SIGKILL escalation. Exit state now controls escalation and timer cleanup.
- Rapid orchestrator pause/resume could launch overlapping workflows. A tracked workflow promise serializes lifecycle transitions and prevents draining runners from being discarded.
- Running tasks left by a server restart were excluded from the pending queue. Resume requeues interrupted tasks while retaining existing workspace progress.
- Recovery ignored the session's disabled auto-recovery flag. Those sessions now remain paused.
- Stopping during an API retry cleared its abort controller and allowed another request. Retry checks now also require an active runner.
- Executing npm directly without a shell failed on Windows. npm commands now run its installed CLI through the Node executable.
- Cached package metadata ignored entry-point edits between project starts. Each start reads package.json afresh.
- HTML injection corrupted compressed Node project responses. The proxy now decompresses HTML before transformation and updates framing/validators, while preserving streaming for SSE and other responses.
- Event subscriptions made before socket creation were lost, and subscriptions did not follow authentication reconnects. Subscriptions now attach to each active socket and clean up the previous instance.

## Validation

- `npm test`: 32 passing tests (17 existing continuity regressions and 15 additional regressions).
- New tests use in-memory SQLite, local HTTP/Socket.IO servers, temporary project files, a real npm invocation and controlled process/timer doubles.
- The proxy regression checks compressed HTML, compressed JSON, HEAD and delivery of an open SSE stream.
- Backend and frontend production builds and frontend TypeScript checking are run separately.
- Regressions were reproduced before correction for token rotation, approval migration, daily bonus rollback, credit validation, kill escalation, workflow overlap, interrupted task recovery, disabled automatic recovery, stopped API retries, socket reconnection and compressed HTML.

## Upgrade impact and limits

Legacy bcrypt refresh sessions are revoked during migration because their original tokens cannot be safely recovered. Existing users will need to log in again when their access token expires or they reopen the application.

Validation uses local simulated provider failures; it does not certify availability of a real external provider or deployment. The frontend build reports its existing warning about large JavaScript chunks. These checks do not establish that the entire project is defect-free.
