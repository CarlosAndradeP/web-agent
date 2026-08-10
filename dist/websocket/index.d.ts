import type { Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { CreditManager } from '../services/credit-manager.js';
import type { OrchestratorSessionsRepository } from '../db/repositories/orchestrator.js';
import { type JwtPayload } from '../lib/jwt.js';
declare module 'socket.io' {
    interface SocketData {
        user?: JwtPayload;
    }
}
export declare function setupWebSocket(io: Server, approvalManager: ApprovalManager, taskManager: TaskManager, creditManager: CreditManager, orchestratorSessionsRepo?: OrchestratorSessionsRepository): void;
//# sourceMappingURL=index.d.ts.map