import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { env } from '../config/env';
import { buildGoogleAuthUrl, exchangeCodeForProfile } from '../auth/google';
import { signAccessToken } from '../auth/jwt';
import { currentUser, requireAuth } from '../auth/require-auth';
import { readCookie } from '../http/cookies';
import { HttpError } from '../http/errors';
import { findUserById, upsertGoogleUser } from '../users/users.repository';

// The "state" is a random value we hand Google and also keep in a cookie in this
// browser. Google echoes it back on the callback. If the two don't match, the
// callback didn't come from a login this browser started (a CSRF attempt), so we refuse.
const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_OPTIONS = {
  httpOnly: true, // page JavaScript can't read it
  sameSite: 'lax' as const, // still sent when Google redirects the browser back to us
  secure: env.NODE_ENV === 'production', // HTTPS-only in production
  path: '/api/auth/google', // only sent to the login routes
};

// Compares in constant time, so response timing leaks nothing about the expected value.
function sameString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// The callback is a full-page browser visit, not a fetch, so we answer with
// redirects to the frontend instead of JSON.
// The result goes in the URL fragment (#...): browsers never send the fragment to any
// server, so the token stays out of server logs, proxies and Referer headers.
function redirectToFrontend(res: Response, fragment: Record<string, string>) {
  res.redirect(`${env.FRONTEND_URL}/auth/callback#${new URLSearchParams(fragment)}`);
}

export const authRouter = Router();

// GET /api/auth/google: the "Sign in with Google" button links here.
authRouter.get('/google', (_req, res) => {
  const state = crypto.randomBytes(32).toString('base64url');
  res.cookie(STATE_COOKIE, state, { ...STATE_COOKIE_OPTIONS, maxAge: 10 * 60 * 1000 });
  res.redirect(buildGoogleAuthUrl(state));
});

// GET /api/auth/google/callback: Google sends the browser back here.
authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = readCookie(req, STATE_COOKIE);
  // The state is single-use: clear it whatever happens next.
  res.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);

  // e.g. "access_denied" when the user clicks Cancel on Google's screen.
  if (typeof error === 'string') return redirectToFrontend(res, { error });
  if (typeof code !== 'string' || typeof state !== 'string') {
    return redirectToFrontend(res, { error: 'missing_code' });
  }
  if (!expectedState || !sameString(state, expectedState)) {
    return redirectToFrontend(res, { error: 'invalid_state' });
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    const user = await upsertGoogleUser(profile);
    redirectToFrontend(res, { token: signAccessToken(user) });
  } catch (err) {
    console.error('[auth] Google login failed:', (err as Error).message);
    redirectToFrontend(res, { error: 'google_login_failed' });
  }
});

// GET /api/auth/me: who am I? The frontend calls this on load to check its token
// and to draw the header (name, avatar, Slack status).
authRouter.get('/me', requireAuth, async (req, res) => {
  // Read from the database, not just the token: a deleted user's old token stops working.
  const user = await findUserById(currentUser(req).id);
  if (!user) throw new HttpError(401, 'User no longer exists');
  res.json({ user });
});
