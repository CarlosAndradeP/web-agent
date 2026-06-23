import type { Socket, Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
export declare function registerSocketEvents(socket: Socket, io: Server, approvalManager: ApprovalManager, taskManager: TaskManager): void;
//# sourceMappingURL=events.d.ts.map