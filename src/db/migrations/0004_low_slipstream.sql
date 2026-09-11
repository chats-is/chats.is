CREATE TABLE "email_verification_code" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evc_email_idx" ON "email_verification_code" USING btree ("email");--> statement-breakpoint
CREATE INDEX "evc_expires_idx" ON "email_verification_code" USING btree ("expires");