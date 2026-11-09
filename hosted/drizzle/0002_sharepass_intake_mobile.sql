CREATE TABLE sharepass_mobile_sessions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX sharepass_mobile_email ON sharepass_mobile_sessions(email);
--> statement-breakpoint
CREATE TABLE sharepass_intakes (
  token TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  operator TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  payload TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX sharepass_intake_operator ON sharepass_intakes(workspace,operator,confirmed,expires_at);
