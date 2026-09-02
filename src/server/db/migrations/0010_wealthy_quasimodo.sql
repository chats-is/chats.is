ALTER TABLE "prompt" ADD COLUMN "owner_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint

WITH "prompt_owner" AS (
  SELECT COALESCE(
    (
      SELECT "id"
      FROM "user"
      WHERE "role" = 'admin'
      ORDER BY "created_at"
      LIMIT 1
    ),
    (
      SELECT "id"
      FROM "user"
      ORDER BY "created_at"
      LIMIT 1
    )
  ) AS "user_id"
)
UPDATE "prompt"
SET
  "owner_kind" = CASE
    WHEN "type" = 'system' THEN NULL
    ELSE 'admin'
  END,
  "user_id" = CASE
    WHEN "type" = 'user' THEN (SELECT "user_id" FROM "prompt_owner")
    ELSE NULL
  END,
  "is_public" = CASE
    WHEN "type" = 'user' THEN true
    ELSE false
  END;--> statement-breakpoint

ALTER TABLE "prompt" ADD CONSTRAINT "prompt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_owner_kind_idx" ON "prompt" USING btree ("owner_kind");--> statement-breakpoint
CREATE INDEX "prompt_user_id_idx" ON "prompt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prompt_is_public_idx" ON "prompt" USING btree ("is_public");--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_owner_access_check" CHECK ((
        ("prompt"."type" = 'system' and "prompt"."owner_kind" is null and "prompt"."user_id" is null and "prompt"."is_public" = false)
        or
        ("prompt"."type" = 'user' and "prompt"."owner_kind" = 'admin' and "prompt"."user_id" is not null and "prompt"."is_public" = true)
        or
        ("prompt"."type" = 'user' and "prompt"."owner_kind" = 'user' and "prompt"."user_id" is not null)
      ));--> statement-breakpoint
