import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from '../config/env';
import { getEmailQueue } from '../queue/email-queue';

export const BULL_BOARD_PATH = '/admin/queues';

// Bull Board is a ready-made web UI for BullMQ: live counts of delayed, waiting,
// active, completed and failed jobs, and each job's data, result and error. It reads
// the same Redis the workers use, so it shows every worker's jobs.
export function createBullBoardRouter() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue())],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'Email Scheduler' } },
  });
  return serverAdapter.getRouter();
}

function sameSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// The dashboard can delete and retry jobs, so it must never be public. It's opened
// by typing a URL into the browser, which can't attach our Bearer token, so we use
// HTTP Basic auth: the browser shows its own login prompt, and the password comes
// from env. Over ngrok/production this travels inside HTTPS.
export const requireDashboardLogin: RequestHandler = (req, res, next) => {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    // Check both even if the first fails, so timing doesn't reveal which was wrong.
    const userOk = sameSecret(username, env.BULL_BOARD_USERNAME);
    const passOk = sameSecret(password, env.BULL_BOARD_PASSWORD);
    if (separator !== -1 && userOk && passOk) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Email Scheduler queues", charset="UTF-8"');
  res.status(401).send('Authentication required');
};
