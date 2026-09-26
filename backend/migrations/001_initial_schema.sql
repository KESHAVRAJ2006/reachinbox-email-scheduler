-- Core data model.
-- Postgres is the source of truth. Redis/BullMQ only holds "wake up at time X for
-- email Y", and that can always be rebuilt from the emails table after a restart.
-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- People who log in with Google.
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id   TEXT NOT NULL UNIQUE,   -- Google's stable "sub" id: an email address can change, this can't
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SMTP accounts that emails are sent from (Ethereal test accounts).
-- Shared by all users; the user picks one in the Compose form.
CREATE TABLE senders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,          -- display name used in the From header
  email       TEXT NOT NULL UNIQUE,
  smtp_host   TEXT NOT NULL,
  smtp_port   INTEGER NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,          -- test-only credentials; a production system would encrypt this column
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One Compose submission: same subject/body, many recipients.
CREATE TABLE campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES senders(id),
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  start_at          TIMESTAMPTZ NOT NULL,
  delay_between_ms  INTEGER NOT NULL CHECK (delay_between_ms >= 0),
  hourly_limit      INTEGER NOT NULL CHECK (hourly_limit > 0),  -- campaign-level cap used by the planner
  total_emails      INTEGER NOT NULL CHECK (total_emails > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per recipient. Its id is also the BullMQ jobId: adding the same job twice
-- is ignored by BullMQ, which is half of our "never send twice" guarantee. The other
-- half is the worker's atomic claim (status 'scheduled' -> 'sending').
CREATE TABLE emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- copied from the campaign so "my emails" needs no join
  sender_id     UUID NOT NULL REFERENCES senders(id),
  recipient     TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,   -- when it should go out; pushed to the next hour if the sender's cap is hit
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_at    TIMESTAMPTZ,            -- when a worker claimed it
  sent_at       TIMESTAMPTZ,
  message_id    TEXT,                   -- SMTP Message-ID returned on success
  preview_url   TEXT,                   -- Ethereal link to view the delivered email
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient)       -- a CSV with a duplicate address can't mail that person twice
);

-- Dashboard tabs: "my scheduled emails, soonest first" and "my sent emails".
CREATE INDEX emails_user_status_time_idx ON emails (user_id, status, scheduled_at);

-- Restart reconciler: "every email still waiting to be sent". A partial index only
-- stores the rows matching the WHERE, so it stays small as sent emails pile up.
CREATE INDEX emails_pending_idx ON emails (scheduled_at) WHERE status = 'scheduled';

-- One Slack connection per user, saved by the "Connect Slack" OAuth flow.
CREATE TABLE slack_connections (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_name     TEXT NOT NULL,
  channel_name  TEXT NOT NULL,
  webhook_url   TEXT NOT NULL,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
