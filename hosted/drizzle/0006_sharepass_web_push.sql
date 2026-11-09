CREATE TABLE sharepass_web_push (
  endpoint TEXT PRIMARY KEY, workspace TEXT NOT NULL, booth_id TEXT NOT NULL,
  operator TEXT NOT NULL, device_id TEXT, expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sharepass_web_push_booth ON sharepass_web_push (workspace, booth_id, expires_at);
