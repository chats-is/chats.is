ALTER TABLE "payment" ADD COLUMN "external_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "external_refund_id" varchar(255);