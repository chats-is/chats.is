CREATE TABLE "model_pricing" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"input" numeric(20, 10),
	"output" numeric(20, 10),
	"cache_read" numeric(20, 10),
	"cache_write" numeric(20, 10),
	"reasoning" numeric(20, 10),
	"image" numeric(20, 10),
	"video" numeric(20, 10),
	"video_seconds" numeric(20, 10),
	"audio_input" numeric(20, 10),
	"audio_output" numeric(20, 10),
	"audio_characters" numeric(20, 10),
	"source" varchar(50) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_pricing_model_id_unique" UNIQUE("model_id")
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"quota_id" varchar(255) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "quota" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"five_hour" numeric(20, 10),
	"seven_day" numeric(20, 10),
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"allowed_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"chat_id" varchar(255),
	"message_id" varchar(255),
	"model_id" varchar(255),
	"provider_id" varchar(255),
	"capability" varchar(32) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"video_seconds" numeric(12, 3) DEFAULT '0' NOT NULL,
	"audio_input_tokens" integer DEFAULT 0 NOT NULL,
	"audio_output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_characters" integer DEFAULT 0 NOT NULL,
	"input_price" numeric(20, 10),
	"output_price" numeric(20, 10),
	"cache_read_price" numeric(20, 10),
	"cache_write_price" numeric(20, 10),
	"reasoning_price" numeric(20, 10),
	"image_price" numeric(20, 10),
	"video_price" numeric(20, 10),
	"video_seconds_price" numeric(20, 10),
	"audio_input_price" numeric(20, 10),
	"audio_output_price" numeric(20, 10),
	"audio_characters_price" numeric(20, 10),
	"cost" numeric(20, 10) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "model_provider_model_unique";--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "email_verification_code" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verification_code" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompt" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "provider" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "provider" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "setting" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "setting" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "share" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "plan_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "quota_id" varchar(255);--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_model_id_unique" UNIQUE("model_id");--> statement-breakpoint
ALTER TABLE "model_pricing" ADD CONSTRAINT "model_pricing_model_id_model_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_quota_id_quota_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."quota"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_chat_id_idx" ON "usage" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "usage_model_id_idx" ON "usage" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "usage_created_at_idx" ON "usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_user_created_idx" ON "usage" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_quota_id_quota_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."quota"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_plan_id_idx" ON "user" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "user_quota_id_idx" ON "user" USING btree ("quota_id");