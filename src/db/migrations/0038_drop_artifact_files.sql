DELETE FROM "artifact" WHERE "type" IN ('image', 'file');--> statement-breakpoint
ALTER TABLE "artifact" DROP COLUMN "file_url";--> statement-breakpoint
ALTER TABLE "artifact" DROP COLUMN "mime_type";--> statement-breakpoint
ALTER TABLE "artifact" DROP COLUMN "size";