DROP INDEX "chat_type_idx";--> statement-breakpoint
DROP INDEX "chat_userId_type_createdAt_idx";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "type";