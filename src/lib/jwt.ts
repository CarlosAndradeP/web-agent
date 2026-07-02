import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('JWT');

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

export function signAccessToken(payload: { userId: string; role: 'admin' | 'user'; }): string {
  return jwt.sign({ ...payload, type: 'access' }, config.accessTokenSecret, { expiresIn: '15m' });
}

export function signRefreshToken(payload: { userId: string }): string {
  return jwt.sign({ userId: payload.userId, type: 'refresh' }, config.refreshTokenSecret, { expiresIn: '7d' });
}

/**
 * Verifies an ACCESS token. Rejects refresh tokens (which have a different secret
 * anyway) and tokens that fail signature/expiry checks.
 */
export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, config.accessTokenSecret) as any;
  if (payload.type && payload.type !== 'access') {
    log.warn('Rejected token with wrong type claim', { type: payload.type });
    throw new Error('Invalid token type');
  }
  return payload as JwtPayload;
}

/**
 * Verifies a REFRESH token. Uses the refresh secret and requires the type claim.
 */
export function verifyRefreshToken(token: string): RefreshJwtPayload {
  const payload = jwt.verify(token, config.refreshTokenSecret) as any;
  if (payload.type !== 'refresh') {
    throw new Error('Invalid refresh token');
  }
  return payload as RefreshJwtPayload;
}
