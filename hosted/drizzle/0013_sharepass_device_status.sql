CREATE TABLE sharepass_device_status (
  device_id TEXT NOT NULL PRIMARY KEY,
  first_connected_at INTEGER,
  last_seen_at INTEGER NOT NULL,
  app_version TEXT,
  app_version_code INTEGER,
  platform TEXT CHECK(platform IN ('android','web')),
  notifications_enabled INTEGER CHECK(notifications_enabled IN (0,1))
);
--> statement-breakpoint
CREATE INDEX sharepass_ledger_history ON sharepass_ledger_deposits(owner,event,booth,(payload->>'created_at') DESC,id DESC);
