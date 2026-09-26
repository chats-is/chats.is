CREATE TABLE "tier" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"price_multiplier" numeric(10, 4) DEFAULT '1' NOT NULL,
	"model_restriction_mode" varchar(8) DEFAULT 'allow' NOT NULL,
	"model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tier_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "tier_id" varchar(255);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "tier_id" varchar(255);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "price_multiplier" numeric(10, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "spend" numeric(20, 10) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "tier_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota" DROP COLUMN "allowed_model_ids";
--> statement-breakpoint
-- Every call so far was spent at the cost price.
UPDATE "usage" SET "spend" = "cost";
