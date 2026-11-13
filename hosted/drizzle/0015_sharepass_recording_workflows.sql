ALTER TABLE sharepass_configured_booths ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
--> statement-breakpoint
ALTER TABLE sharepass_staff_prompts ADD COLUMN per_person INTEGER NOT NULL DEFAULT 0 CHECK(per_person IN (0,1));
--> statement-breakpoint
CREATE TABLE sharepass_staff_prompt_recipients (
 workspace TEXT NOT NULL, prompt_id TEXT NOT NULL, recipient TEXT NOT NULL,
 name TEXT NOT NULL, booth_id TEXT NOT NULL,
 reply TEXT CHECK(reply IN ('done','working','help')), replied_at INTEGER,
 PRIMARY KEY(workspace,prompt_id,recipient)
);
--> statement-breakpoint
CREATE INDEX sharepass_staff_prompt_inbox ON sharepass_staff_prompt_recipients(workspace,recipient,reply,prompt_id);
