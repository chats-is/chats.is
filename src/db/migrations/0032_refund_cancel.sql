ALTER TABLE "payment" ADD COLUMN "refund_cancel_subscription" boolean;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "canceled_by" varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_canceled_by_user_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;