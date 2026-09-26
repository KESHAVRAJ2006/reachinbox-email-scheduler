// Importing env first means a bad config stops the process before anything else starts.
import { env } from './config/env';
import { createApp } from './app';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { redis } from './lib/redis';
import { elastic } from './lib/elastic';
import { closeEmailQueue } from './queue/email-queue';
import { ensureEmailIndex } from './search/email-index';

async function main() {
  // Bring the schema up to date before accepting traffic. Safe to run on every boot:
  // already-applied files are skipped.
  const applied = await runMigrations();
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);

  // Search is a copy of Postgres, so ES being down must not stop the API from
  // scheduling emails. Warn and carry on.
  await ensureEmailIndex().catch((err: Error) => console.warn('[search] index not ready:', err.message));

  const server = createApp().listen(env.PORT, (err?: Error) => {
    // Express 5 passes startup errors (e.g. port already in use) to this callback.
    if (err) {
      console.error(`[api] could not listen on port ${env.PORT}:`, err.message);
      process.exit(1);
    }
    console.log(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown on Ctrl+C (SIGINT) or a platform stop (SIGTERM):
  // stop accepting new connections, let in-flight requests finish, then close pools.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} received, shutting down`);

    server.close(async () => {
      await Promise.allSettled([closeEmailQueue(), pool.end(), redis.quit(), elastic.close()]);
      process.exit(0);
    });
    // If something hangs, don't wait forever. unref() stops this timer keeping Node alive.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
