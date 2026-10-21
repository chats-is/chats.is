CREATE TABLE "tier_model" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"tier_id" varchar(255) NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tier_model" ADD CONSTRAINT "tier_model_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_model" ADD CONSTRAINT "tier_model_model_id_model_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tier_model_tier_id_model_id_idx" ON "tier_model" USING btree ("tier_id","model_id");--> statement-breakpoint
-- A tier's models, one row each — those still there: a model deleted
-- matched nothing in the list, and has nothing to point at now.
INSERT INTO "tier_model" ("id", "tier_id", "model_id") SELECT gen_random_uuid()::text, "tier"."id", "model"."model_id" FROM "tier" CROSS JOIN LATERAL (SELECT DISTINCT "value" FROM jsonb_array_elements_text("tier"."model_ids")) AS "listed" JOIN "model" ON "model"."model_id" = "listed"."value";--> statement-breakpoint
ALTER TABLE "tier" DROP COLUMN "model_ids";