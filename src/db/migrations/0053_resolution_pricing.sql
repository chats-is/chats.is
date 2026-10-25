ALTER TABLE "model_pricing" ADD COLUMN "video_tokens" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "resolution_prices" jsonb;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "video_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "resolution" varchar(32);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "video_tokens_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "reason" text;