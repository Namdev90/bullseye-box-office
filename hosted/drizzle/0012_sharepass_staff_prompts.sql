CREATE TABLE sharepass_staff_prompts (
  workspace TEXT NOT NULL, id TEXT NOT NULL, booth_id TEXT NOT NULL,
  message TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  reply TEXT CHECK(reply IN ('done','working','help')),
  replied_by TEXT, responder TEXT, replied_at INTEGER,
  PRIMARY KEY(workspace,id)
);
--> statement-breakpoint
CREATE INDEX sharepass_staff_prompt_booth ON sharepass_staff_prompts(workspace,booth_id,reply,created_at);
