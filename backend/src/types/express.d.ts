import type { AuthUser } from '../auth/jwt';

// Teach TypeScript that Express requests can carry the logged-in user.
// requireAuth sets it; routes read it through currentUser(req).
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
