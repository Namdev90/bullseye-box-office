CREATE TABLE sharepass_owner_passwords (
  owner_id TEXT PRIMARY KEY NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sharepass_owner_sessions (
  digest TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sharepass_owner_sessions_expiry ON sharepass_owner_sessions(expires);
--> statement-breakpoint
CREATE INDEX sharepass_owner_sessions_owner ON sharepass_owner_sessions(owner_id);
--> statement-breakpoint
ALTER TABLE sharepass_configured_devices ADD COLUMN designation TEXT NOT NULL DEFAULT 'Counter staff' CHECK(designation IN ('Counter staff','Deposit desk','Collection desk'));
