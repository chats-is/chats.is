CREATE TABLE "document" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"media_type" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"encoding" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_url_idx" ON "document" USING btree ("url");--> statement-breakpoint
CREATE INDEX "document_user_id_idx" ON "document" USING btree ("user_id");