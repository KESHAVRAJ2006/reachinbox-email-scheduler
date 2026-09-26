import { Pool } from 'pg';
import { env } from '../config/env';

// One pool per process. A pool keeps a few connections open and lends them to
// queries, instead of paying the TCP + authentication handshake on every query.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

// If Postgres restarts, idle pooled connections emit 'error'. Without a listener,
// Node treats that as an unhandled error and kills the whole process.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
