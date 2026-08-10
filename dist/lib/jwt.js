import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('JWT');
export function signAccessToken(payload) {
    return jwt.sign({ ...payload, type: 'access' }, config.accessTokenSecret, { expiresIn: '15m' });
}
export function signRefreshToken(payload) {
    return jwt.sign({ userId: payload.userId, type: 'refresh' }, config.refreshTokenSecret, { expiresIn: '7d' });
}
/**
 * Verifies an ACCESS token. Rejects refresh tokens (which have a different secret
 * anyway) and tokens that fail signature/expiry checks.
 */
export function verifyToken(token) {
    const payload = jwt.verify(token, config.accessTokenSecret);
    if (payload.type && payload.type !== 'access') {
        log.warn('Rejected token with wrong type claim', { type: payload.type });
        throw new Error('Invalid token type');
    }
    return payload;
}
/**
 * Verifies a REFRESH token. Uses the refresh secret and requires the type claim.
 */
export function verifyRefreshToken(token) {
    const payload = jwt.verify(token, config.refreshTokenSecret);
    if (payload.type !== 'refresh') {
        throw new Error('Invalid refresh token');
    }
    return payload;
}
//# sourceMappingURL=jwt.js.map