import { pool } from '../db/pool';
import type { GoogleProfile } from '../auth/google';

// Shape the API returns. camelCase for JSON, while the database uses snake_case.
export type UserProfile = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slack: { connected: boolean; channel: string | null };
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  slack_channel: string | null;
};

function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    slack: { connected: row.slack_channel !== null, channel: row.slack_channel },
  };
}

// First login creates the user; later logins refresh name, email and avatar.
// ON CONFLICT makes this one atomic statement, so two logins at the same moment
// can't create two rows for the same Google account.
export async function upsertGoogleUser(profile: GoogleProfile) {
  const { rows } = await pool.query<{ id: string; email: string; name: string }>(
    `INSERT INTO users (google_id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = now()
     RETURNING id, email, name`,
    [profile.googleId, profile.email, profile.name, profile.avatarUrl],
  );
  return rows[0];
}

export async function findUserById(id: string): Promise<UserProfile | null> {
  // LEFT JOIN: users without a Slack connection still come back, with NULL channel.
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.email, u.name, u.avatar_url, s.channel_name AS slack_channel
       FROM users u
       LEFT JOIN slack_connections s ON s.user_id = u.id
      WHERE u.id = $1`,
    [id],
  );
  return rows[0] ? toProfile(rows[0]) : null;
}
