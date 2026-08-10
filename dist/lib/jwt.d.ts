export interface JwtPayload {
    userId: string;
    role: 'admin' | 'user';
    type?: 'access' | 'refresh';
}
export interface AccessJwtPayload extends JwtPayload {
    type: 'access';
}
export interface RefreshJwtPayload {
    userId: string;
    type: 'refresh';
}
export declare function signAccessToken(payload: {
    userId: string;
    role: 'admin' | 'user';
}): string;
export declare function signRefreshToken(payload: {
    userId: string;
}): string;
/**
 * Verifies an ACCESS token. Rejects refresh tokens (which have a different secret
 * anyway) and tokens that fail signature/expiry checks.
 */
export declare function verifyToken(token: string): JwtPayload;
/**
 * Verifies a REFRESH token. Uses the refresh secret and requires the type claim.
 */
export declare function verifyRefreshToken(token: string): RefreshJwtPayload;
//# sourceMappingURL=jwt.d.ts.map