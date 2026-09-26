import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Locally we read backend/.env. On a hosting platform the variables are injected
// directly into the process, so the file is optional. process.loadEnvFile is built
// into Node 20.12+, which is why this project needs no "dotenv" package.
// Variables already set in the real environment win over the file.
const envFile = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Every env var is a string. z.coerce.number() turns "5" into 5 and rejects "abc".
const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_URL: z.url(),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  ELASTICSEARCH_URL: z.url(),

  // 32+ characters so the JWT signature can't be brute-forced.
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'use a number followed by s, m, h or d, e.g. 7d')
    .default('7d'),

  GOOGLE_CLIENT_ID: z.string().endsWith('.apps.googleusercontent.com', 'does not look like a Google OAuth client ID'),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.url(),

  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_REDIRECT_URI: z.url().refine((url) => url.startsWith('https://'), 'Slack only accepts https:// redirect URLs'),

  // Login for the Bull Board queue dashboard at /admin/queues.
  BULL_BOARD_USERNAME: z.string().min(1),
  BULL_BOARD_PASSWORD: z.string().min(12, 'must be at least 12 characters'),

  // Throughput settings. No defaults on purpose: rate limits must be chosen explicitly
  // per environment, never silently baked into the code.
  WORKER_CONCURRENCY: positiveInt,
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().int().min(0),
  MAX_EMAILS_PER_HOUR_PER_SENDER: positiveInt,
});

const parsed = envSchema.safeParse(process.env);

// Fail fast: refusing to boot with a readable list of problems beats crashing
// hours later in the middle of sending a campaign.
if (!parsed.success) {
  console.error('Invalid environment configuration. Fix backend/.env (see backend/.env.example):');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

// Typed and validated. The rest of the code imports `env` and never touches process.env.
export const env = parsed.data;
export type Env = typeof env;
