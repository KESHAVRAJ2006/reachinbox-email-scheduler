import { Router, type Response } from 'express';
import { env } from '../config/env';
import { signSlackConnectState, verifySlackConnectState } from '../auth/jwt';
import { currentUser, requireAuth } from '../auth/require-auth';
import { HttpError } from '../http/errors';
import { buildSlackAuthorizeUrl, exchangeSlackCode } from '../integrations/slack/slack.oauth';
import { postSlackMessage } from '../integrations/slack/slack.notifier';
import { deleteSlackConnection, findWebhookUrl, saveSlackConnection } from '../integrations/slack/slack.repository';

export const slackRouter = Router();

// After the Slack round trip, send the browser back to the dashboard with the result.
function backToFrontend(res: Response, params: Record<string, string>) {
  res.redirect(`${env.FRONTEND_URL}/?${new URLSearchParams(params)}`);
}

// POST /api/integrations/slack/connect: the "Connect Slack" button calls this with
// its Bearer token and gets back the Slack URL to open.
slackRouter.post('/connect', requireAuth, (req, res) => {
  res.json({ url: buildSlackAuthorizeUrl(signSlackConnectState(currentUser(req).id)) });
});

// GET /api/integrations/slack/callback: Slack sends the browser here after Allow or
// Cancel. Reached through the ngrok HTTPS domain, because Slack refuses http:// URLs.
slackRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (typeof error === 'string') return backToFrontend(res, { slack: 'error', reason: error });
  const userId = typeof state === 'string' ? verifySlackConnectState(state) : null;
  if (!userId) return backToFrontend(res, { slack: 'error', reason: 'invalid_state' });
  if (typeof code !== 'string') return backToFrontend(res, { slack: 'error', reason: 'missing_code' });

  try {
    const install = await exchangeSlackCode(code);
    await saveSlackConnection(userId, install);
    backToFrontend(res, { slack: 'connected', channel: install.channelName });
  } catch (err) {
    console.error('[slack] connect failed:', (err as Error).message);
    backToFrontend(res, { slack: 'error', reason: 'slack_connect_failed' });
  }
});

// POST /api/integrations/slack/test: sends a test message to the connected channel.
slackRouter.post('/test', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const webhookUrl = await findWebhookUrl(user.id);
  if (!webhookUrl) throw new HttpError(409, 'Slack is not connected');
  await postSlackMessage(webhookUrl, `:white_check_mark: Email Scheduler is connected. Alerts for *${user.name}* will appear here.`);
  res.json({ sent: true });
});

// DELETE /api/integrations/slack: forget the webhook. Alerts stop immediately.
slackRouter.delete('/', requireAuth, async (req, res) => {
  const removed = await deleteSlackConnection(currentUser(req).id);
  res.json({ disconnected: removed });
});
