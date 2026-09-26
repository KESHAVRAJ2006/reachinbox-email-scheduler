import { Redis } from 'ioredis';
import { env } from '../config/env';

// BullMQ requires maxRetriesPerRequest: null. Its workers use blocking Redis commands
// that must wait indefinitely rather than fail after a few retries. We use the same
// settings everywhere so any connection can be handed to BullMQ.
export function createRedisConnection(label: string): Redis {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // ioredis reconnects on its own; we only log. An unhandled 'error' event would crash Node.
  connection.on('error', (err) => console.error(`[redis:${label}]`, err.message));
  return connection;
}

// Shared connection for plain commands (health check, rate-limit counters).
export const redis = createRedisConnection('app');
