import { verifyToken } from '../lib/jwt.js';
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    let token;
    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }
    if (!token) {
        res.status(401).json({ error: 'Authorization required' });
        return;
    }
    try {
        req.user = verifyToken(token);
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
//# sourceMappingURL=auth.js.map