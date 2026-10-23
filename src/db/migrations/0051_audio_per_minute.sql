ALTER TABLE "model_pricing" ADD COLUMN "audio_minute" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "audio_minute_price" numeric(20, 10);--> statement-breakpoint
-- A transcription model's rate, per second until now, per minute from here:
-- the same rate, told for sixty seconds. The usage rows' snapshot of it too,
-- so a row reads as every other does; what each one cost is unchanged.
UPDATE "model_pricing" SET "audio_minute" = "audio_seconds" * 60 WHERE "audio_seconds" IS NOT NULL;--> statement-breakpoint
UPDATE "usage" SET "audio_minute_price" = "audio_seconds_price" * 60 WHERE "audio_seconds_price" IS NOT NULL;
