import { env } from '../config/env';
import { redis } from '../lib/redis';
import { hourWindow } from '../scheduler/planner';

// Counters only matter for their own hour; keep them a little longer, then let
// Redis delete them automatically.
const COUNTER_TTL_SECONDS = 2 * 60 * 60;

/**
 * Runs INSIDE Redis as one atomic step. Redis executes one script at a time, so
 * no other worker can read or change the counter between our "check" and our
 * "increment". Without this, two workers could both read 199, both decide "under
 * 200", and both send: 201 emails. With it, the cap holds with any number of workers.
 *
 * Returns the new count (1..limit) if a slot was reserved, or -1 if the hour is full.
 */
const RESERVE_SLOT_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then
  return -1
end
used = redis.call('INCR', KEYS[1])
if used == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return used
`;

// One key per sender per clock hour, e.g. rl:count:<senderId>:491234
export function senderCounterKey(senderId: string, window: number): string {
  return `rl:count:${senderId}:${window}`;
}

export type SlotResult =
  | { allowed: true; used: number; limit: number; window: number }
  | { allowed: false; limit: number; window: number };

export async function reserveSenderSlot(senderId: string): Promise<SlotResult> {
  const window = hourWindow(Date.now());
  const limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const result = Number(
    await redis.eval(RESERVE_SLOT_SCRIPT, 1, senderCounterKey(senderId, window), limit, COUNTER_TTL_SECONDS),
  );
  return result === -1 ? { allowed: false, limit, window } : { allowed: true, used: result, limit, window };
}
