CREATE TABLE "payment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255),
	"user_email" varchar(255) NOT NULL,
	"subscription_id" varchar(255),
	"plan_id" varchar(255) NOT NULL,
	"processor" varchar(32) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"transaction_id" varchar(255),
	"amount" numeric(12, 2) NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_by" varchar(255),
	"refund_request_id" varchar(255),
	"refund_fee" varchar(8),
	"refund_at" timestamp with time zone,
	"fee" numeric(12, 2),
	"tax" numeric(12, 2),
	"status" varchar(32) NOT NULL,
	"invoice_url" text,
	"billed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunded_check" CHECK ("payment"."refund_amount" <= "payment"."amount"),
	CONSTRAINT "payment_refund_request_check" CHECK ("payment"."refund_request_id" is null or "payment"."refund_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "refund_request" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"subscription_id" varchar(255) NOT NULL,
	"status" varchar(32) NOT NULL,
	"reason" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_id" varchar(255) NOT NULL,
	"interval" varchar(8) NOT NULL,
	"processor" varchar(32) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"customer_id" varchar(255) NOT NULL,
	"status" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"canceled_at" timestamp with time zone,
	"cancel_reason" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_canceled_check" CHECK ("subscription"."status" <> 'canceled' or ("subscription"."canceled_at" is not null and "subscription"."cancel_reason" is not null)),
	CONSTRAINT "subscription_cancel_pair_check" CHECK (("subscription"."canceled_at" is null) = ("subscription"."cancel_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "billing_type" varchar(8);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "processor" varchar(32);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "monthly_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "monthly_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "yearly_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "yearly_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "is_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_refund_by_user_id_fk" FOREIGN KEY ("refund_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_refund_request_id_refund_request_id_fk" FOREIGN KEY ("refund_request_id") REFERENCES "public"."refund_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_processor_external_idx" ON "payment" USING btree ("processor","external_id");--> statement-breakpoint
CREATE INDEX "payment_user_id_idx" ON "payment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_transaction_idx" ON "payment" USING btree ("processor","transaction_id");--> statement-breakpoint
CREATE INDEX "payment_refund_request_idx" ON "payment" USING btree ("refund_request_id");--> statement-breakpoint
CREATE INDEX "payment_billed_at_idx" ON "payment" USING btree ("billed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_request_pending_idx" ON "refund_request" USING btree ("subscription_id") WHERE "refund_request"."status" = 'pending_approval';--> statement-breakpoint
CREATE INDEX "refund_request_user_id_idx" ON "refund_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refund_request_status_idx" ON "refund_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_processor_external_idx" ON "subscription" USING btree ("processor","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_user_active_idx" ON "subscription" USING btree ("user_id") WHERE "subscription"."status" = 'active';--> statement-breakpoint
CREATE INDEX "subscription_user_id_idx" ON "subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_status_created_idx" ON "subscription" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_processor_monthly_price_idx" ON "plan" USING btree ("processor","monthly_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_processor_yearly_price_idx" ON "plan" USING btree ("processor","yearly_price_id");