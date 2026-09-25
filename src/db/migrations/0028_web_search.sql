ALTER TABLE "model_pricing" ADD COLUMN "web_search" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "supports_web_search" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "web_searches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "web_search_price" numeric(20, 10);