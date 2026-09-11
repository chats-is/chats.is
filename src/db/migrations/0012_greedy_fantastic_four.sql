UPDATE "prompt" SET "capability" = 'chat' WHERE "capability" IS NULL;--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "capability" SET DEFAULT 'chat';--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "capability" SET NOT NULL;
