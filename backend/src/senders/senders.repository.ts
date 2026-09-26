import { pool } from '../db/pool';

// Senders with this SMTP host are load-test doubles: the mailer builds their
// messages but never sends them. ".invalid" is a reserved domain that can never
// resolve, so a real connection to it is impossible even by mistake.
export const LOAD_TEST_SMTP_HOST = 'loadtest.invalid';

// What the API may show. SMTP credentials never leave the backend.
export type PublicSender = { id: string; name: string; email: string };

// Load-test doubles are hidden from the Compose form.
export async function listSenders(): Promise<PublicSender[]> {
  const { rows } = await pool.query<PublicSender>(
    'SELECT id, name, email FROM senders WHERE smtp_host <> $1 ORDER BY created_at',
    [LOAD_TEST_SMTP_HOST],
  );
  return rows;
}

export async function findSenderById(id: string): Promise<PublicSender | null> {
  const { rows } = await pool.query<PublicSender>('SELECT id, name, email FROM senders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function countSenders(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM senders');
  return Number(rows[0].count); // Postgres count() is a bigint, which pg returns as a string
}

export async function insertSender(sender: {
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}): Promise<PublicSender> {
  const { rows } = await pool.query<PublicSender>(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email`,
    [sender.name, sender.email, sender.smtpHost, sender.smtpPort, sender.smtpUser, sender.smtpPass],
  );
  return rows[0];
}
