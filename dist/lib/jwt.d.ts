export interface JwtPayload {
    userId: string;
    role: 'admin' | 'user';
}
export declare function signAccessToken(payload: JwtPayload): string;
export declare function signRefreshToken(payload: {
    userId: string;
}): string;
export declare function verifyToken(token: string): JwtPayload;
//# sourceMappingURL=jwt.d.ts.map