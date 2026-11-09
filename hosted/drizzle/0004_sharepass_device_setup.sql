CREATE TABLE sharepass_configured_booths (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  poster_token TEXT NOT NULL UNIQUE,
  PRIMARY KEY(workspace,id)
);
--> statement-breakpoint
CREATE TABLE sharepass_configured_staff (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL PRIMARY KEY,
  booth_id TEXT NOT NULL,
  name TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sharepass_configured_devices (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL PRIMARY KEY,
  staff_id TEXT NOT NULL,
  label TEXT NOT NULL,
  invite TEXT NOT NULL UNIQUE,
  setup_code TEXT NOT NULL,
  invite_expires INTEGER NOT NULL,
  digest TEXT UNIQUE,
  session_expires INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX sharepass_active_setup_code ON sharepass_configured_devices(setup_code) WHERE setup_code<>'';
--> statement-breakpoint
CREATE TABLE sharepass_setup_limits (
  scope TEXT NOT NULL,
  minute INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY(scope,minute)
);
--> statement-breakpoint
ALTER TABLE sharepass_booth_queue ADD COLUMN booth_id TEXT NOT NULL DEFAULT 'B1';
--> statement-breakpoint
CREATE INDEX sharepass_booth_queue_scope ON sharepass_booth_queue(workspace,booth_id,confirmed,expires_at);
