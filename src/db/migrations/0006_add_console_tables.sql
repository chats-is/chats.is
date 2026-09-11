CREATE TABLE "model" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"capability" varchar(32) NOT NULL,
	"image" text,
	"aliases" jsonb,
	"supports_vision" boolean DEFAULT false,
	"supports_reasoning" boolean DEFAULT false,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"ui_options" jsonb,
	"api_params" jsonb,
	"system_prompt_id" varchar(255),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"capability" varchar(32),
	"providers" jsonb,
	"image" text,
	"content" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"image" text,
	"api_key" text NOT NULL,
	"base_url" varchar(500),
	"is_enabled" boolean DEFAULT false NOT NULL,
	"api_options" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text,
	"description" varchar(500),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "chat" RENAME COLUMN "model" TO "model_id";
--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_system_prompt_id_prompt_id_fk" FOREIGN KEY ("system_prompt_id") REFERENCES "public"."prompt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_provider_id_idx" ON "model" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "model_capability_idx" ON "model" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "model_is_enabled_idx" ON "model" USING btree ("is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_model_unique" ON "model" USING btree ("provider_id","model_id");--> statement-breakpoint
CREATE INDEX "prompt_type_idx" ON "prompt" USING btree ("type");--> statement-breakpoint
CREATE INDEX "prompt_capability_idx" ON "prompt" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "provider_type_idx" ON "provider" USING btree ("type");--> statement-breakpoint
CREATE INDEX "provider_is_enabled_idx" ON "provider" USING btree ("is_enabled");
