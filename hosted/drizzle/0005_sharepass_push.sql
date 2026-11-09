CREATE TABLE sharepass_push_tokens (
  device_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE sharepass_push_limits (
  workspace TEXT NOT NULL,
  booth_id TEXT NOT NULL,
  next_send_at INTEGER NOT NULL,
  PRIMARY KEY (workspace,booth_id)
);
