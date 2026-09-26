import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

// Who is making the request. Stored inside the token, so the server doesn't need
// a session table: the signature proves we issued it and nobody edited it.
export type AuthUser = { id: string; email: string; name: string };

const ISSUER = 'email-scheduler-api';

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, env.JWT_SECRET, {
    algorithm: 'HS256', // HMAC with our secret: only this server can create valid tokens
    subject: user.id, // standard "sub" claim = user id
    issuer: ISSUER,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

// Returns the user for a valid token, or null for anything else (bad signature,
// expired, wrong issuer, garbage). Callers turn null into a 401.
export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      // Pin the algorithm. Otherwise a forged token could claim "alg: none"
      // or a different algorithm to skip or confuse signature checking.
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    if (typeof payload === 'string' || !payload.sub) return null;
    return { id: payload.sub, email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}
