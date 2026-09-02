-- Move the auth tables from NextAuth's shape to better-auth's.
--
-- Hand-written: drizzle-kit cannot tell that one `verification` table replaces
-- two, and three of the steps carry data semantics it has no way to infer.
-- Lands the tables in their final shape; nothing is left to reconcile.

--> statement-breakpoint
-- `user.name` becomes NOT NULL. Rows that predate this can have no name — a
-- sign-in by emailed code never collected one. Fall back to the local part of
-- the address so the constraint can be added without dropping anyone.
UPDATE "user" SET "name" = split_part("email", '@', 1) WHERE "name" IS NULL;
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint

-- NextAuth stored *when* an address was confirmed; better-auth stores *whether*
-- it was. A non-null timestamp becomes true; the timestamp is not kept.
ALTER TABLE "user" ADD COLUMN "email_verified_bool" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "user" SET "email_verified_bool" = ("email_verified" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_verified";
--> statement-breakpoint
ALTER TABLE "user" RENAME COLUMN "email_verified_bool" TO "email_verified";
--> statement-breakpoint

ALTER TABLE "user" ADD CONSTRAINT "user_email_unique" UNIQUE ("email");
--> statement-breakpoint

-- Sessions are disposable — everyone signed in is signed out by this, which is
-- the correct outcome for a change of session format.
DROP TABLE IF EXISTS "session" CASCADE;
--> statement-breakpoint
CREATE TABLE "session" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "token" varchar(255) NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_token_unique" UNIQUE ("token")
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
--> statement-breakpoint

-- `account` holds the OAuth links, so its rows are carried across: without
-- them an existing Google or GitHub user is re-linked on their next sign-in
-- instead of being recognised.
--
-- The old table is dropped before the new indexes and constraints are added,
-- because renaming a table does not rename what hangs off it — the old index
-- would still own the name below.
ALTER TABLE "account" RENAME TO "account_old";
--> statement-breakpoint
CREATE TABLE "account" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "provider_id" varchar(255) NOT NULL,
  "issuer" varchar(255) NOT NULL,
  "account_id" varchar(255) NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "account" (
  "id", "user_id", "provider_id", "issuer", "account_id",
  "access_token", "refresh_token", "id_token",
  "access_token_expires_at", "scope", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  "user_id",
  "provider",
  -- better-auth 1.7 scopes an account's identity by issuer. An OAuth provider
  -- without an issuer of its own gets `local:oauth:<providerId>`, which is what
  -- it will compute at the next sign-in — backfilling anything else would leave
  -- the existing link unmatched and silently create a second account.
  'local:oauth:' || "provider",
  "provider_account_id",
  "access_token",
  "refresh_token",
  "id_token",
  -- NextAuth stored this as a unix epoch in seconds.
  CASE WHEN "expires_at" IS NULL THEN NULL ELSE to_timestamp("expires_at") END,
  "scope",
  now(),
  now()
FROM "account_old";
--> statement-breakpoint
DROP TABLE "account_old" CASCADE;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
--> statement-breakpoint
-- Two providers must not be able to claim the same identity.
CREATE UNIQUE INDEX "account_issuer_account_id_idx"
  ON "account" ("issuer", "account_id");
--> statement-breakpoint

-- One table replaces both `verification_token` and `email_verification_code`.
-- Both held short-lived rows; nothing is carried over.
DROP TABLE IF EXISTS "verification_token" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "email_verification_code" CASCADE;
--> statement-breakpoint
CREATE TABLE "verification" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "identifier" varchar(255) NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
