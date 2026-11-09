ALTER TABLE sharepass_ledger_codes ADD COLUMN reused INTEGER NOT NULL DEFAULT 0 CHECK(reused IN (0,1));
--> statement-breakpoint
CREATE INDEX sharepass_ledger_collection_deposit ON sharepass_ledger_collections(owner,deposit_id,pending);
