import { env } from '../../config/env';

// Step 1: the Slack page where the user picks a workspace and channel, then clicks Allow.
// `incoming-webhook` is the only permission we ask for: "post messages into the one
// channel you choose". We can't read messages or see anything else.
export function buildSlackAuthorizeUrl(state: string): string {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', 'incoming-webhook');
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

export type SlackInstall = { teamName: string; channelName: string; webhookUrl: string };

// Step 2, server to server: swap the one-time code (plus our client secret) for the
// webhook URL Slack created for the chosen channel.
export async function exchangeSlackCode(code: string): Promise<SlackInstall> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      // Must equal the redirect_uri used in step 1, or Slack rejects the exchange.
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  // Slack answers HTTP 200 even for errors; the real result is the `ok` field.
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    team?: { name?: string };
    team_name?: string;
    incoming_webhook?: { url?: string; channel?: string };
  };
  if (!data.ok) throw new Error(`Slack rejected the code: ${data.error ?? 'unknown error'}`);
  if (!data.incoming_webhook?.url) throw new Error('Slack response has no incoming webhook');

  return {
    teamName: data.team?.name ?? data.team_name ?? 'Slack workspace',
    channelName: data.incoming_webhook.channel ?? 'unknown channel',
    webhookUrl: data.incoming_webhook.url,
  };
}
