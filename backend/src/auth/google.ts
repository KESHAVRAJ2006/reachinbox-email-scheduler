import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

// Google's official client. It builds the consent URL, swaps the one-time code for
// tokens, and checks the ID token's signature against Google's public keys.
const googleClient = new OAuth2Client({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: env.GOOGLE_CALLBACK_URL,
});

export type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

// Step 1: the URL we send the browser to. Google shows the account picker and
// consent screen, then redirects back to GOOGLE_CALLBACK_URL with ?code=...&state=...
export function buildGoogleAuthUrl(state: string): string {
  return googleClient.generateAuthUrl({
    // openid + email + profile = "tell me who this person is". Nothing more:
    // we never read their Gmail, Drive, etc.
    scope: ['openid', 'email', 'profile'],
    state,
    // We only need their identity once, at login, so we don't ask Google for a
    // refresh token we would then have to store and protect.
    access_type: 'online',
    prompt: 'select_account',
  });
}

// Step 2: server-to-server. Exchange the one-time code (plus our client secret) for
// an ID token, verify it, and return the profile inside it.
export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const { tokens } = await googleClient.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an ID token');

  // Checks the signature, expiry, issuer, and that the token was issued for OUR
  // client id (audience). A token minted for another app is rejected.
  const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) throw new Error('Google ID token is missing sub or email');
  if (!payload.email_verified) throw new Error('Google account email is not verified');

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    avatarUrl: payload.picture ?? null,
  };
}
