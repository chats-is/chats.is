ALTER TABLE "model_pricing" ADD COLUMN "x_post" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "x_profile" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "x_posts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "x_profiles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "x_post_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "x_profile_price" numeric(20, 10);