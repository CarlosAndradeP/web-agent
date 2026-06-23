import type { Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { CreditManager } from '../services/credit-manager.js';
export declare function setupWebSocket(io: Server, approvalManager: ApprovalManager, taskManager: TaskManager, creditManager: CreditManager): void;
//# sourceMappingURL=index.d.ts.map