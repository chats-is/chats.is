ALTER TABLE "chat" ADD COLUMN "type" varchar(32) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_type_idx" ON "chat" USING btree ("type");