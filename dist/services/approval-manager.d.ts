import type { Server } from 'socket.io';
import type { ApprovalRequest } from '../types/index.js';
export declare class ApprovalManager {
    private pending;
    private io;
    setIo(io: Server): void;
    requestApproval(request: ApprovalRequest, userId?: string): Promise<boolean>;
    respond(id: string, approved: boolean): void;
    hasPending(id: string): boolean;
}
//# sourceMappingURL=approval-manager.d.ts.map