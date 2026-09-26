import type { Request } from 'express';

// Express can SET cookies (res.cookie) but doesn't parse incoming ones. We only
// read one cookie in the whole app, so a few lines beat another dependency.
// The Cookie header looks like: "a=1; oauth_state=abc123; b=2"
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
}
