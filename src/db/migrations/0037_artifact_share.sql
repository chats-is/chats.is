DROP INDEX "share_chatId_idx";--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "share" ADD COLUMN "artifact_id" varchar(255);--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_artifact_id_idx" ON "share" USING btree ("artifact_id");--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_chat_id_artifact_id_check" CHECK (("share"."chat_id" is null) <> ("share"."artifact_id" is null));