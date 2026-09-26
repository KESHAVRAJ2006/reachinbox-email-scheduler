/**
 * The planner turns a campaign ("N emails, start at T, D ms apart, at most L per
 * hour") into one concrete send time per email. It is a pure function (no database,
 * no clock, no Redis), which makes it trivial to unit-test.
 */

export const HOUR_MS = 60 * 60 * 1000;

// Hours are fixed, UTC-aligned blocks: window 491_000 = one specific clock hour.
// The worker's per-sender Redis counter (Phase 4) numbers hours the same way,
// so both limits agree on what "this hour" means.
export function hourWindow(timestampMs: number): number {
  return Math.floor(timestampMs / HOUR_MS);
}

/**
 * Where the worker moves an email that didn't fit in its sender's hourly cap:
 * the start of the next hour, plus 1 ms for every second the email was originally
 * scheduled into the current hour. So emails that overflow together keep their
 * original order, and all of them land in the first ~3.6 s of the next hour.
 */
export function overflowSendTime(originalScheduledAt: number, fullWindow: number): number {
  const secondsIntoWindow = Math.floor(Math.max(0, originalScheduledAt - fullWindow * HOUR_MS) / 1000);
  return (fullWindow + 1) * HOUR_MS + Math.min(secondsIntoWindow, 3599);
}

export type PlanInput = {
  count: number; // how many emails
  startAt: number; // epoch ms of the first send
  delayBetweenMs: number; // gap between consecutive sends
  hourlyLimit: number; // max sends from this campaign in any one clock hour
};

export function planSendTimes({ count, startAt, delayBetweenMs, hourlyLimit }: PlanInput): number[] {
  const times: number[] = [];
  let at = startAt;
  let window = hourWindow(at);
  let usedInWindow = 0;

  for (let i = 0; i < count; i++) {
    if (i > 0) at += delayBetweenMs;

    // The delay carried us into a new hour: that hour starts with a fresh budget.
    if (hourWindow(at) !== window) {
      window = hourWindow(at);
      usedInWindow = 0;
    }

    // This hour is full: move to the first millisecond of the next hour.
    // Times only ever move forward, so recipient order is preserved.
    if (usedInWindow >= hourlyLimit) {
      window += 1;
      at = window * HOUR_MS;
      usedInWindow = 0;
    }

    times.push(at);
    usedInWindow++;
  }
  return times;
}
