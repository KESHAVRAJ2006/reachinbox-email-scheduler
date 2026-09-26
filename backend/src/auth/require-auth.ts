import type { Request, RequestHandler } from 'express';
import { HttpError } from '../http/errors';
import { verifyAccessToken, type AuthUser } from './jwt';

// Put in front of any route that needs a logged-in user. Expects the header:
//   Authorization: Bearer <jwt>
export const requireAuth: RequestHandler = (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    next(new HttpError(401, 'Missing bearer token'));
    return;
  }

  const user = verifyAccessToken(token);
  if (!user) {
    next(new HttpError(401, 'Invalid or expired token'));
    return;
  }

  req.user = user;
  next();
};

// Typed access to the user inside a protected route. Throws if a route forgot
// requireAuth, so that mistake shows up as a 401, never as "undefined.id".
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}
