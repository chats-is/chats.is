CREATE TABLE IF NOT EXISTS "artifact" (
	"id" varchar(255) NOT NULL,
	"chat_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"type" varchar(32) NOT NULL,
	"language" varchar(64),
	"content" text,
	"file_url" text,
	"file_name" varchar(255),
	"mime_type" varchar(255),
	"size" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_id" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_chatId_idx" ON "artifact" USING btree ("chat_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_messageId_idx" ON "artifact" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_userId_idx" ON "artifact" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_createdAt_idx" ON "artifact" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_chatId_createdAt_idx" ON "artifact" USING btree ("chat_id","created_at");
