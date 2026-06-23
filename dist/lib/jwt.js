import jwt from 'jsonwebtoken';
import { config } from '../config.js';
export function signAccessToken(payload) {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}
export function signRefreshToken(payload) {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}
export function verifyToken(token) {
    return jwt.verify(token, config.jwtSecret);
}
//# sourceMappingURL=jwt.js.map