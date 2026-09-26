import type {
  CampaignInput,
  CampaignResult,
  EmailPage,
  EmailStats,
  SearchResult,
  Sender,
  Tab,
  User,
} from './types';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// The JWT lives in localStorage so a page refresh keeps you logged in. Trade-off:
// any script running on this page could read it, which is why the app renders no
// untrusted HTML (search highlights are escaped by Elasticsearch).
const TOKEN_KEY = 'email-scheduler.token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// An API error with the server's message and, for 400s, the invalid fields.
export class ApiError extends Error {
  readonly status: number;
  readonly details?: { field: string; message: string }[];

  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// AuthContext registers what to do when the token is rejected (log out).
let handleUnauthorized = () => {};
export function onUnauthorized(handler: () => void) {
  handleUnauthorized = handler;
}

// Every request goes through here: adds the Bearer token, sends/parses JSON, and
// turns non-2xx responses into ApiError.
async function request<T>(path: string, options: { method?: string; json?: unknown } = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token) handleUnauthorized();
    throw new ApiError(response.status, data?.error ?? `Request failed (${response.status})`, data?.details);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  senders: () => request<{ senders: Sender[] }>('/api/senders'),
  stats: () => request<EmailStats>('/api/emails/stats'),
  emails: (tab: Tab, limit: number, offset: number) =>
    request<EmailPage>(`/api/emails?tab=${tab}&limit=${limit}&offset=${offset}`),
  search: (q: string) => request<SearchResult>(`/api/emails/search?q=${encodeURIComponent(q)}&limit=50`),
  createCampaign: (input: CampaignInput) => request<CampaignResult>('/api/campaigns', { method: 'POST', json: input }),
  slackConnect: () => request<{ url: string }>('/api/integrations/slack/connect', { method: 'POST' }),
  slackTest: () => request<{ sent: boolean }>('/api/integrations/slack/test', { method: 'POST' }),
  slackDisconnect: () => request<{ disconnected: boolean }>('/api/integrations/slack', { method: 'DELETE' }),
};

// Full-page navigation to the API, which redirects to Google.
export const googleLoginUrl = `${API_URL}/api/auth/google`;
