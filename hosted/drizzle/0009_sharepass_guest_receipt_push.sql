CREATE TABLE sharepass_receipt_push (
  ticket TEXT PRIMARY KEY, workspace TEXT NOT NULL, booth_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sharepass_receipt_push_expiry ON sharepass_receipt_push(expires_at);
--> statement-breakpoint
CREATE INDEX sharepass_ledger_request_deposit ON sharepass_ledger_requests(owner,deposit_id,id);
