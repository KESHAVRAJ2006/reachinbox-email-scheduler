import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/**
 * An expected failure with a status code the client should see, e.g.
 *   throw new HttpError(404, 'Campaign not found');
 * Anything that is NOT an HttpError is treated as a bug: logged, and hidden behind a 500.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

// Runs when no route matched. It turns the request into a 404 HttpError so the
// error handler below formats every error the same way.
export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
};

// Express recognises an error handler by its four parameters. Express 5 also routes
// errors thrown in async handlers here, with no try/catch or wrapper needed.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  // Request body failed a zod schema: tell the client which fields and why.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  // Errors from express.json() carry their own 4xx status and a `type`.
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Unknown error = bug. Log everything server-side, but never leak stack traces or
  // SQL details to the client.
  console.error(`[api] unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error' });
};
