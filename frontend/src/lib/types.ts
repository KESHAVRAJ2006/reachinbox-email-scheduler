// Shapes of the JSON the backend returns. Kept by hand to match the API.

export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';
export type Tab = 'scheduled' | 'sent';

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slack: { connected: boolean; channel: string | null };
};

export type Sender = { id: string; name: string; email: string };

export type EmailRow = {
  id: string;
  recipient: string;
  subject: string;
  senderEmail: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  lastError: string | null;
};

export type EmailPage = { emails: EmailRow[]; total: number };

export type EmailStats = { scheduled: number; sent: number; failed: number };

export type SearchHit = {
  id: string;
  recipient: string;
  subject: string;
  senderEmail: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  // HTML with <mark> tags, already escaped by Elasticsearch (encoder: html).
  highlight: { subject?: string; body?: string };
};

export type SearchResult = { total: number; hits: SearchHit[] };

export type CampaignInput = {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
};

export type CampaignResult = {
  campaignId: string;
  totalEmails: number;
  duplicatesRemoved: number;
  firstSendAt: string;
  lastSendAt: string;
};
