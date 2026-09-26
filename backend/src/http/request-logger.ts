import type { RequestHandler } from 'express';

// One log line per request, written when the response finishes:
//   GET /api/health 200 12.3ms
// Only the path is logged, never the query string: OAuth callbacks carry one-time
// codes in it (?code=...), and secrets don't belong in log files.
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(`${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
};
