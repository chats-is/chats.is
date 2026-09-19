-- A model reaches its providers through `model_provider` alone. The column
-- beside it was the single-provider link from before that table existed, and
-- since then only a mirror of the first enabled binding, written on every
-- create and update and read by nothing that could not read the bindings.

-- Insurance before it goes: a model with no binding at all would lose its last
-- link. 0015 backfilled every model that existed then, and both writers make a
-- binding since — so this should match nothing, and costs nothing if it does.
INSERT INTO "model_provider" ("id", "model_id", "provider_id", "priority", "is_enabled", "created_at", "updated_at")
SELECT gen_random_uuid()::text, m."model_id", m."provider_id", 0, true, now(), now()
FROM "model" m
WHERE NOT EXISTS (
  SELECT 1 FROM "model_provider" b WHERE b."model_id" = m."model_id"
);--> statement-breakpoint
ALTER TABLE "model" DROP CONSTRAINT "model_provider_id_provider_id_fk";--> statement-breakpoint
DROP INDEX "model_provider_id_idx";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "provider_id";
