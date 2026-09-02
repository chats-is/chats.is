CREATE TABLE "model_provider" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"provider_model_id" varchar(255),
	"priority" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_provider" ADD CONSTRAINT "model_provider_model_id_model_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider" ADD CONSTRAINT "model_provider_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_model_provider_idx" ON "model_provider" USING btree ("model_id","provider_id");--> statement-breakpoint
CREATE INDEX "model_provider_priority_idx" ON "model_provider" USING btree ("model_id","priority");--> statement-breakpoint
-- Backfill: seed one priority=0 binding per existing model from its legacy provider_id
INSERT INTO "model_provider" ("id", "model_id", "provider_id", "provider_model_id", "priority", "is_enabled", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "model_id", "provider_id", NULL, 0, true, now(), now()
FROM "model";