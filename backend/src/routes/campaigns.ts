import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/require-auth';
import { createCampaignSchema, scheduleCampaign } from '../campaigns/campaigns.service';
import { listEmailsForUser } from '../emails/emails.repository';
import { searchEmails } from '../search/email-index';
import { listSenders } from '../senders/senders.repository';

// Mounted at /api. Each route lists requireAuth itself (instead of router.use), so
// unknown paths under /api still fall through to the 404 handler, not a 401.
export const campaignsRouter = Router();

// GET /api/senders: accounts the user can pick in the Compose form.
campaignsRouter.get('/senders', requireAuth, async (_req, res) => {
  res.json({ senders: await listSenders() });
});

// POST /api/campaigns: schedule a campaign. `parse` throws a ZodError on bad
// input, which the central error handler turns into a 400 listing each bad field.
campaignsRouter.post('/campaigns', requireAuth, async (req, res) => {
  const input = createCampaignSchema.parse(req.body);
  const result = await scheduleCampaign(currentUser(req).id, input);
  res.status(201).json(result);
});

// GET /api/emails?tab=scheduled|sent&limit=50&offset=0: the dashboard tables.
const listQuerySchema = z.object({
  tab: z.enum(['scheduled', 'sent']).default('scheduled'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

campaignsRouter.get('/emails', requireAuth, async (req, res) => {
  const { tab, limit, offset } = listQuerySchema.parse(req.query);
  res.json(await listEmailsForUser(currentUser(req).id, tab, limit, offset));
});

// GET /api/emails/search?q=welcome&tab=sent: full-text search via Elasticsearch
// over subject, recipient and body. Only ever searches the caller's own emails.
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  tab: z.enum(['scheduled', 'sent']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

campaignsRouter.get('/emails/search', requireAuth, async (req, res) => {
  const query = searchQuerySchema.parse(req.query);
  res.json(await searchEmails(currentUser(req).id, query));
});
