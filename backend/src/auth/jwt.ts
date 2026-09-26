import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

// Who is making the request. Stored inside the token, so the server doesn't need
// a session table: the signature proves we issued it and nobody edited it.
export type AuthUser = { id: string; email: string; name: string };

const ISSUER = 'email-scheduler-api';

// "aud" (audience) says what a token is FOR. Every token we sign has one, and every
// check demands the right one, so a short-lived Slack state token can never be
// replayed as a login token, or the other way round.
const AUDIENCE_API = 'api';
const AUDIENCE_SLACK_CONNECT = 'slack-connect';

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, env.JWT_SECRET, {
    algorithm: 'HS256', // HMAC with our secret: only this server can create valid tokens
    subject: user.id, // standard "sub" claim = user id
    issuer: ISSUER,
    audience: AUDIENCE_API,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

// Returns the user for a valid token, or null for anything else (bad signature,
// expired, wrong issuer/audience, garbage). Callers turn null into a 401.
export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      // Pin the algorithm. Otherwise a forged token could claim "alg: none"
      // or a different algorithm to skip or confuse signature checking.
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE_API,
    });
    if (typeof payload === 'string' || !payload.sub) return null;
    return { id: payload.sub, email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}

// The "Connect Slack" round trip leaves our site (browser -> Slack -> our callback),
// so the callback can't see the user's Authorization header. Instead, the user id
// travels in the OAuth `state` as a signed token that expires in 10 minutes.
export function signSlackConnectState(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE_SLACK_CONNECT,
    expiresIn: '10m',
  });
}

export function verifySlackConnectState(state: string): string | null {
  try {
    const payload = jwt.verify(state, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE_SLACK_CONNECT,
    });
    return typeof payload === 'string' ? null : (payload.sub ?? null);
  } catch {
    return null;
  }
}
