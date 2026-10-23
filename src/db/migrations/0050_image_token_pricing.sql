ALTER TABLE "model_pricing" ADD COLUMN "image_input" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "image_output" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "image_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "image_output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "image_input_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "image_output_price" numeric(20, 10);--> statement-breakpoint
-- An image model's output rate, as the sources quote it and as it was kept,
-- is what a picture drawn costs: it becomes that, and the words it writes,
-- with no rate of their own, are billed at it as before.
UPDATE "model_pricing" SET "image_output" = "output", "output" = NULL WHERE "image" IS NULL AND "output" IS NOT NULL AND "model_id" IN (SELECT "model_id" FROM "model" WHERE "capability" = 'image');
