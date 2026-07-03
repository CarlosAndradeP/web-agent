import { createLogger } from '../services/logger.js';
const log = createLogger('ApprovalManager');
export class ApprovalManager {
    pending = new Map();
    io = null;
    setIo(io) {
        this.io = io;
        log.info('Socket.IO instance set');
    }
    requestApproval(request, userId) {
        log.info('Approval requested', { id: request.id, toolName: request.toolName, userId });
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.pending.delete(request.id);
                log.warn('Approval timed out (5min)', { id: request.id });
                resolve(false);
            }, 300000);
            this.pending.set(request.id, { resolve, timeout, userId });
            if (this.io) {
                const target = userId ? this.io.to(`user:${userId}`) : this.io;
                target.emit('approval:request', request);
                log.info('Approval request emitted via Socket.IO', { id: request.id, userId });
            }
            else {
                log.warn('No Socket.IO instance, approval request not sent to client', { id: request.id });
            }
        });
    }
    respond(id, approved, responderUserId, isAdmin) {
        const entry = this.pending.get(id);
        if (!entry) {
            log.warn('No pending approval found for response', { id });
            return;
        }
        // Check ownership: only the approval owner or an admin can respond. If the
        // approval was registered without a userId (e.g. task created without an
        // owner) we reject by default — never allow an unauthenticated ownership
        // bypass. Admins can still respond to userId-less approvals.
        if (!isAdmin) {
            if (!entry.userId || !responderUserId || entry.userId !== responderUserId) {
                log.warn('Approval response denied — not owner', { id, responderUserId, ownerUserId: entry.userId });
                return;
            }
        }
        clearTimeout(entry.timeout);
        entry.resolve(approved);
        this.pending.delete(id);
        log.info('Approval responded', { id, approved });
    }
    hasPending(id) {
        return this.pending.has(id);
    }
}
//# sourceMappingURL=approval-manager.js.map