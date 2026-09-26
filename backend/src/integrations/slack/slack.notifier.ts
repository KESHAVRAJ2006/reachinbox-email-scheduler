import { HOUR_MS } from '../../scheduler/planner';
import { findWebhooksAffectedBySender } from './slack.repository';

// Incoming webhook = one HTTPS POST with a JSON body. The 5 s timeout means a slow
// Slack can never hold up the worker.
export async function postSlackMessage(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    // e.g. 404 "no_service" when the user removed the app from Slack.
    throw new Error(`Slack webhook answered ${response.status}: ${await response.text()}`);
  }
}

// <!date^UNIX^{time}|fallback> is Slack's date syntax: every reader sees the time in
// their OWN timezone (e.g. IST), and old clients see the UTC fallback text.
function slackTime(ms: number): string {
  const fallback = new Date(ms).toISOString().slice(11, 16) + ' UTC';
  return `<!date^${Math.floor(ms / 1000)}^{time}|${fallback}>`;
}

/**
 * Called by the worker the moment a sender uses its last slot of the hour.
 * It never throws: a Slack problem must never affect sending.
 */
export async function notifySenderLimitReached(input: {
  triggeringUserId: string;
  sender: { id: string; email: string };
  limit: number;
  window: number;
}): Promise<void> {
  try {
    const hourStart = input.window * HOUR_MS;
    const hourEnd = hourStart + HOUR_MS;
    const targets = await findWebhooksAffectedBySender(input.triggeringUserId, input.sender.id, new Date(hourEnd));
    if (targets.length === 0) {
      console.log(`[slack] ${input.sender.email} hit its limit; no affected user has Slack connected`);
      return;
    }

    const text =
      `:warning: *Hourly sending limit reached*\n` +
      `Sender \`${input.sender.email}\` has sent its maximum of *${input.limit} emails* ` +
      `for ${slackTime(hourStart)}–${slackTime(hourEnd)}.\n` +
      `Nothing is lost: remaining emails are paused and will resume automatically at *${slackTime(hourEnd)}*.`;

    // allSettled: one user's broken webhook doesn't stop the others being told.
    const results = await Promise.allSettled(targets.map((target) => postSlackMessage(target.webhookUrl, text)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`[slack] alert to user ${targets[i].userId} failed:`, (result.reason as Error).message);
      }
    });
    const delivered = results.filter((result) => result.status === 'fulfilled').length;
    console.log(`[slack] limit alert for ${input.sender.email} delivered to ${delivered}/${targets.length} user(s)`);
  } catch (err) {
    console.error('[slack] could not send limit alert:', (err as Error).message);
  }
}
