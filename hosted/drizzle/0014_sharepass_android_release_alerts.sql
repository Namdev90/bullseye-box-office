CREATE TABLE sharepass_android_release_state (
  id INTEGER NOT NULL PRIMARY KEY CHECK(id=1),
  version_code INTEGER NOT NULL,
  version_name TEXT NOT NULL,
  manifest TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO sharepass_android_release_state(id,version_code,version_name,manifest,accepted_at)
  VALUES(1,23,'0.9.13','',0);
--> statement-breakpoint
CREATE TABLE sharepass_android_release_deliveries (
  version_code INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER,
  last_status INTEGER,
  PRIMARY KEY(version_code,device_id)
);
