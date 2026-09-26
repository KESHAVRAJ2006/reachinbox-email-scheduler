/**
 * Load test: schedules N emails (default 1000) all due NOW and checks the guarantees.
 *
 *   1. Start 1-3 workers first, each in its own terminal:  npm run dev:worker
 *   2. npm run loadtest            (or: npm run loadtest -- 5000)
 *
 * Uses a throwaway user and two load-test senders, whose messages are built but
 * never sent over the network (see LOAD_TEST_SMTP_HOST). It waits until everything
 * due this hour is handled, prints a report, and then deletes everything it created.
 */
import { scheduleCampaign } from '../campaigns/campaigns.service';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { redis } from '../lib/redis';
import { closeEmailQueue, getEmailQueue } from '../queue/email-queue';
import { HOUR_MS, hourWindow } from '../scheduler/planner';
import { insertSender, LOAD_TEST_SMTP_HOST } from '../senders/senders.repository';
import { senderCounterKey } from '../worker/sender-rate-limit';

const TIMEOUT_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const total = Number(process.argv[2] ?? 1000);
  const perSender = Math.ceil(total / 2);
  const cap = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const queue = getEmailQueue();

  // --- Setup: throwaway user and two dry-run senders
  const suffix = Date.now().toString(36);
  const { rows: [user] } = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, name) VALUES ($1, $2, 'Load Test') RETURNING id`,
    [`loadtest-${suffix}`, `loadtest-${suffix}@example.com`],
  );
  // We call scheduleCampaign directly: the same code POST /api/campaigns runs.
  const senders = [];
  for (const n of [1, 2]) {
    senders.push(
      await insertSender({
        name: `Load Test ${n}`,
        email: `loadtest-${suffix}-${n}@loadtest.invalid`,
        smtpHost: LOAD_TEST_SMTP_HOST,
        smtpPort: 587,
        smtpUser: 'loadtest',
        smtpPass: 'loadtest',
      }),
    );
  }

  console.log(`Scheduling ${total} emails (${perSender} per sender), all due now.`);
  console.log(`Per-sender cap: ${cap}/hour, min gap: ${env.MIN_DELAY_BETWEEN_SENDS_MS} ms\n`);
  const startedAt = Date.now();
  const campaignIds: string[] = [];
  for (const [i, sender] of senders.entries()) {
    const recipients = Array.from({ length: i === 0 ? perSender : total - perSender }, (_, k) =>
      `lt${i + 1}-${String(k).padStart(5, '0')}@example.com`);
    const result = await scheduleCampaign(user.id, {
      senderId: sender.id,
      subject: 'Load test',
      body: 'Load test body',
      recipients,
      startAt: new Date().toISOString(),
      delayBetweenMs: 0,
      hourlyLimit: 100_000, // campaign limit off: we're testing the per-sender cap
    });
    campaignIds.push(result.campaignId);
  }
  console.log(`Scheduled in ${Date.now() - startedAt} ms. Waiting for workers...`);

  // --- Wait until nothing is due: every email is sent, or deferred to a later hour
  const counts = async () => {
    const { rows } = await pool.query<{ sent: string; deferred: string; due: string; failed: string }>(
      `SELECT count(*) FILTER (WHERE status = 'sent') AS sent,
              count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > now()) AS deferred,
              count(*) FILTER (WHERE status IN ('scheduled', 'sending') AND scheduled_at <= now()) AS due,
              count(*) FILTER (WHERE status = 'failed') AS failed
         FROM emails WHERE campaign_id = ANY($1)`,
      [campaignIds],
    );
    return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)])) as Record<string, number>;
  };
  let c = await counts();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    c = await counts();
    const jobs = await queue.getJobCounts('waiting', 'active', 'prioritized');
    process.stdout.write(`\r  sent ${c.sent}  deferred ${c.deferred}  still due ${c.due}  failed ${c.failed}   `);
    if (c.due === 0 && jobs.waiting + jobs.active + jobs.prioritized === 0) break;
    await sleep(500);
  }
  const elapsedMs = Date.now() - startedAt;
  console.log('\n');

  // --- Checks
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`);
  };

  const { rows: perHour } = await pool.query<{ sender_id: string; sent_at: Date }>(
    `SELECT sender_id, sent_at FROM emails WHERE campaign_id = ANY($1) AND status = 'sent'`, [campaignIds]);
  const buckets = new Map<string, number>();
  for (const row of perHour) {
    const key = `${row.sender_id}:${hourWindow(row.sent_at.getTime())}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const busiest = Math.max(0, ...buckets.values());
  check('Per-sender hourly cap held', busiest <= cap, `busiest sender-hour sent ${busiest}, cap ${cap}`);

  const { rows: [dup] } = await pool.query<{ n: string; distinct_n: string }>(
    `SELECT count(message_id) AS n, count(DISTINCT message_id) AS distinct_n FROM emails WHERE campaign_id = ANY($1)`,
    [campaignIds]);
  check('No email sent twice', dup.n === dup.distinct_n, `${dup.n} sent, ${dup.distinct_n} unique message ids`);

  check('Nothing dropped or failed', c.sent + c.deferred === total && c.failed === 0,
    `${c.sent} sent + ${c.deferred} deferred = ${c.sent + c.deferred} of ${total}, ${c.failed} failed`);

  const { rows: [deferred] } = await pool.query<{ earliest: Date | null }>(
    `SELECT min(scheduled_at) AS earliest FROM emails WHERE campaign_id = ANY($1) AND status = 'scheduled'`, [campaignIds]);
  const nextHourStart = (hourWindow(startedAt) + 1) * HOUR_MS;
  check('Overflow moved to the next hour', !deferred.earliest || deferred.earliest.getTime() >= nextHourStart,
    deferred.earliest ? `earliest deferred email now at ${deferred.earliest.toISOString()}` : 'nothing needed deferring');

  const seconds = elapsedMs / 1000;
  console.log(`\nHandled ${total} jobs in ${seconds.toFixed(1)} s (${(total / seconds).toFixed(0)} jobs/s, ${c.sent} real sends)`);

  // --- Cleanup: delayed jobs, counters, rows, senders
  const { rows: ids } = await pool.query<{ id: string }>('SELECT id FROM emails WHERE campaign_id = ANY($1)', [campaignIds]);
  for (const { id } of ids) await queue.remove(id).catch(() => undefined);
  const window = hourWindow(startedAt);
  for (const sender of senders) {
    await redis.del(...[window - 1, window, window + 1, window + 2].map((w) => senderCounterKey(sender.id, w)));
  }
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]); // cascades to campaigns and emails
  await pool.query('DELETE FROM senders WHERE id = ANY($1)', [senders.map((s) => s.id)]);
  console.log('Cleaned up test user, senders, emails, jobs and counters.');

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeEmailQueue();
    await redis.quit();
    await pool.end();
  });
