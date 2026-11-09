CREATE TABLE sharepass_booth_posters (
  workspace TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE sharepass_booth_queue (
  token TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX sharepass_booth_queue_active ON sharepass_booth_queue(workspace,confirmed,expires_at);
