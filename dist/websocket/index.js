import { registerSocketEvents } from './events.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('WebSocket');
export function setupWebSocket(io, approvalManager, taskManager, creditManager) {
    approvalManager.setIo(io);
    taskManager.setIo(io);
    creditManager.setIo(io);
    io.on('connection', (socket) => {
        log.info('Client connected', { socketId: socket.id });
        registerSocketEvents(socket, io, approvalManager, taskManager);
        socket.on('disconnect', (reason) => {
            log.info('Client disconnected', { socketId: socket.id, reason });
        });
    });
    log.info('WebSocket setup complete');
}
//# sourceMappingURL=index.js.map