ALTER TABLE "prompt" DROP CONSTRAINT "prompt_owner_access_check";--> statement-breakpoint
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
  "owner_kind" = 'admin',
  "user_id" = COALESCE("prompt"."user_id", (SELECT "user_id" FROM "prompt_owner")),
  "is_public" = false
WHERE "prompt"."type" = 'system';--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_owner_access_check" CHECK ((
        ("prompt"."type" = 'system' and "prompt"."owner_kind" = 'admin' and "prompt"."user_id" is not null and "prompt"."is_public" = false)
        or
        ("prompt"."type" = 'user' and "prompt"."owner_kind" = 'admin' and "prompt"."user_id" is not null and "prompt"."is_public" = true)
        or
        ("prompt"."type" = 'user' and "prompt"."owner_kind" = 'user' and "prompt"."user_id" is not null)
      ));
