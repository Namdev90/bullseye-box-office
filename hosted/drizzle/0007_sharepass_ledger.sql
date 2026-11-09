CREATE TABLE sharepass_ledger_ready (owner TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_deposits (
 owner TEXT NOT NULL, id TEXT NOT NULL, event TEXT NOT NULL, booth TEXT NOT NULL,
 location TEXT NOT NULL COLLATE NOCASE, revision INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL,
 PRIMARY KEY (owner,id), UNIQUE (owner,event,booth,location)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sharepass_ledger_packet_id ON sharepass_ledger_deposits(owner,event,(payload->>'packet_id'));
--> statement-breakpoint
CREATE TABLE sharepass_ledger_codes (
 owner TEXT NOT NULL, event TEXT NOT NULL, code TEXT NOT NULL, deposit_id TEXT NOT NULL,
 PRIMARY KEY (owner,event,code)
);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_collections (
 owner TEXT NOT NULL, id TEXT NOT NULL, deposit_id TEXT NOT NULL, booth TEXT NOT NULL,
 pending INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sharepass_ledger_one_pending ON sharepass_ledger_collections(owner,deposit_id) WHERE pending=1;
--> statement-breakpoint
CREATE INDEX sharepass_ledger_booth_pending ON sharepass_ledger_collections(owner,booth,deposit_id) WHERE pending=1;
--> statement-breakpoint
CREATE TABLE sharepass_ledger_requests (
 owner TEXT NOT NULL, id TEXT NOT NULL, deposit_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,id)
);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_claims (
 owner TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,token)
);
--> statement-breakpoint
CREATE INDEX sharepass_ledger_claim_expiry ON sharepass_ledger_claims(owner,expires);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_failures (owner TEXT NOT NULL, failed_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sharepass_ledger_failure_window ON sharepass_ledger_failures(owner,failed_at);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_audit (seq INTEGER PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX sharepass_ledger_audit_owner ON sharepass_ledger_audit(owner,seq);
--> statement-breakpoint
CREATE TABLE sharepass_ledger_guard (ok INTEGER CHECK(ok=1));
--> statement-breakpoint
CREATE TRIGGER sharepass_ledger_fence_update BEFORE UPDATE ON sharepass_workspaces
WHEN EXISTS(SELECT 1 FROM sharepass_ledger_ready WHERE owner=OLD.owner_id)
BEGIN SELECT RAISE(ABORT,'SharePass ledger has moved'); END;
--> statement-breakpoint
CREATE TRIGGER sharepass_ledger_fence_insert BEFORE INSERT ON sharepass_workspaces
WHEN EXISTS(SELECT 1 FROM sharepass_ledger_ready WHERE owner=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'SharePass ledger has moved'); END;
--> statement-breakpoint
CREATE INDEX sharepass_booth_queue_expiry ON sharepass_booth_queue(expires_at);
