/**
 * A small migration runner, written instead of pulling in a migration library.
 *
 * - Every file in backend/migrations named like 001_something.sql runs exactly once,
 *   in filename order.
 * - Applied filenames are recorded in the schema_migrations table, so running this
 *   again is a no-op.
 * - Each file runs in its own transaction: it applies completely or not at all.
 * - A Postgres advisory lock makes sure two processes starting at the same moment
 *   (e.g. the API and the worker) never migrate concurrently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';

// Resolves to backend/migrations whether we run from src/ (tsx) or dist/ (node).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

// Any number works, as long as every process uses the same one.
const MIGRATION_LOCK_ID = 7_270_001;

export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect();
  try {
    // Blocks here if another process holds the lock, until it finishes.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.filename));

    // Zero-padded names ("001_", "002_") make alphabetical order equal numeric order.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    const appliedNow: string[] = [];
    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedNow.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return appliedNow;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

// `npm run migrate` executes this file directly. The API imports runMigrations() instead.
if (require.main === module) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date');
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
