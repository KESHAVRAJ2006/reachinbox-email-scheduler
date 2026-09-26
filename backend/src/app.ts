import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestLogger } from './http/request-logger';
import { errorHandler, notFound } from './http/errors';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { campaignsRouter } from './routes/campaigns';

// Builds the Express app without starting it. Keeping this separate from server.ts
// means tests can use the app without opening a real port.
export function createApp() {
  const app = express();

  // First, so even requests rejected by later middleware (e.g. bad JSON) get logged.
  app.use(requestLogger);
  // Security headers (no-sniff, frame blocking, no X-Powered-By, ...).
  app.use(helmet());
  // Only our frontend's origin may call the API from a browser. We send the JWT in an
  // Authorization header, not a cookie, so cross-origin credentials aren't needed.
  app.use(cors({ origin: env.FRONTEND_URL }));
  // Parse JSON bodies. The limit stops someone posting a 500 MB body to exhaust memory.
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', campaignsRouter);

  // These two must come last: the 404 handler catches anything no route matched,
  // and the error handler formats every error thrown above it.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
