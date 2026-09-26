import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR_MS, hourWindow, planSendTimes } from './planner';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

test('spaces emails by the delay when the hourly limit is not reached', () => {
  const times = planSendTimes({ count: 3, startAt: at('2026-01-01T10:00:00Z'), delayBetweenMs: 2000, hourlyLimit: 100 });
  assert.deepEqual(times.map(iso), ['2026-01-01T10:00:00.000Z', '2026-01-01T10:00:02.000Z', '2026-01-01T10:00:04.000Z']);
});

test('moves overflow to the start of the next hour', () => {
  const times = planSendTimes({ count: 5, startAt: at('2026-01-01T10:30:00Z'), delayBetweenMs: 0, hourlyLimit: 2 });
  assert.deepEqual(times.map(iso), [
    '2026-01-01T10:30:00.000Z',
    '2026-01-01T10:30:00.000Z',
    '2026-01-01T11:00:00.000Z',
    '2026-01-01T11:00:00.000Z',
    '2026-01-01T12:00:00.000Z',
  ]);
});

test('crossing an hour boundary through the delay resets the budget', () => {
  // 10:59:58 and 11:00:00 are in different hours, so a limit of 1 is never exceeded
  // and nothing needs to jump.
  const times = planSendTimes({ count: 2, startAt: at('2026-01-01T10:59:58Z'), delayBetweenMs: 2000, hourlyLimit: 1 });
  assert.deepEqual(times.map(iso), ['2026-01-01T10:59:58.000Z', '2026-01-01T11:00:00.000Z']);
});

test('never exceeds the limit in any hour and never reorders (randomised)', () => {
  for (let run = 0; run < 200; run++) {
    const input = {
      count: 1 + Math.floor(Math.random() * 500),
      startAt: at('2026-01-01T00:00:00Z') + Math.floor(Math.random() * HOUR_MS),
      delayBetweenMs: Math.floor(Math.random() * 60_000),
      hourlyLimit: 1 + Math.floor(Math.random() * 50),
    };
    const times = planSendTimes(input);
    assert.equal(times.length, input.count);

    const perHour = new Map<number, number>();
    times.forEach((t, i) => {
      if (i > 0) assert.ok(t >= times[i - 1], 'send times must never go backwards');
      perHour.set(hourWindow(t), (perHour.get(hourWindow(t)) ?? 0) + 1);
    });
    for (const count of perHour.values()) assert.ok(count <= input.hourlyLimit);
  }
});
