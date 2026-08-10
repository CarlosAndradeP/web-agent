import type { Socket, Server } from 'socket.io';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { TaskManager } from '../services/task-manager.js';
import type { OrchestratorSessionsRepository } from '../db/repositories/orchestrator.js';
export declare function registerSocketEvents(socket: Socket, io: Server, approvalManager: ApprovalManager, taskManager: TaskManager, orchestratorSessionsRepo?: OrchestratorSessionsRepository): void;
//# sourceMappingURL=events.d.ts.map