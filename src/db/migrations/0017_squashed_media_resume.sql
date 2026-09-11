ALTER TABLE "model_pricing" ADD COLUMN "audio_seconds" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "audio_seconds" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "audio_seconds_price" numeric(20, 10);
--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "supports_edit" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "supports_transcription" boolean DEFAULT false;
--> statement-breakpoint
-- Partial index for the Library feed: assistant messages that contain media
-- parts (file parts or media tool outputs), scanned per user in reverse
-- chronological order. The jsonpath predicate must stay textually in sync
-- with MEDIA_PARTS_JSONPATH in server/api/routers/library.ts.
CREATE INDEX IF NOT EXISTS "message_library_media_idx"
  ON "message" ("user_id", "created_at" DESC)
  WHERE "role" = 'assistant'
    AND jsonb_path_exists("parts", '$[*] ? (@.type == "file" || @.type like_regex "^tool-(generate_image|edit_image|generate_video|text_to_speech)$")');

--> statement-breakpoint
-- Inline the chat model system prompt (was a FK to a `type=system` prompt
-- record) and retire the system-prompt records concept.

-- 1. Add the new inline column.
ALTER TABLE "model" ADD COLUMN "system_prompt" text;--> statement-breakpoint

-- 2. Copy each model's referenced system-prompt content into the new column.
UPDATE "model" AS m
SET "system_prompt" = p."content"
FROM "prompt" AS p
WHERE m."system_prompt_id" = p."id";--> statement-breakpoint

-- 3. Migrate the global default chat system prompt setting: it stored a prompt
--    id, now it stores the prompt content directly.
UPDATE "setting" AS s
SET "value" = p."content"
FROM "prompt" AS p
WHERE s."key" = 'default.chat.systemPrompt' AND s."value" = p."id";--> statement-breakpoint

-- 4. Title generation now uses a fixed in-code prompt; drop the setting.
DELETE FROM "setting" WHERE "key" = 'title.systemPrompt';--> statement-breakpoint

-- 5. Drop the old FK column.
ALTER TABLE "model" DROP CONSTRAINT IF EXISTS "model_system_prompt_id_prompt_id_fk";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "system_prompt_id";--> statement-breakpoint

-- 6. Remove the now-orphaned system prompt records (content already copied out).
DELETE FROM "prompt" WHERE "type" = 'system';

--> statement-breakpoint
-- Rework prompts into a single library: free-text tags (replacing capability),
-- display-only providers, model-id targeting, and a visibility flag (replacing
-- is_public). ownerKind/type are dropped — an admin is just a user with extra
-- rights, so a prompt is defined by its creator + visibility.

-- 1. New columns.
ALTER TABLE "prompt" ADD COLUMN "visibility" varchar(20) DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "models" jsonb;--> statement-breakpoint

-- 2. Migrate data: is_public -> visibility, capability -> a single tag.
UPDATE "prompt" SET "visibility" = 'public' WHERE "is_public" = true;--> statement-breakpoint
UPDATE "prompt" SET "tags" = jsonb_build_array("capability") WHERE "capability" IS NOT NULL;--> statement-breakpoint

-- 3. Drop the old ownership/visibility/capability machinery.
ALTER TABLE "prompt" DROP CONSTRAINT IF EXISTS "prompt_owner_access_check";--> statement-breakpoint
DROP INDEX IF EXISTS "prompt_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prompt_capability_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prompt_owner_kind_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prompt_is_public_idx";--> statement-breakpoint
ALTER TABLE "prompt" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "prompt" DROP COLUMN "owner_kind";--> statement-breakpoint
ALTER TABLE "prompt" DROP COLUMN "is_public";--> statement-breakpoint
ALTER TABLE "prompt" DROP COLUMN "capability";--> statement-breakpoint

-- 4. New index for visibility lookups.
CREATE INDEX "prompt_visibility_idx" ON "prompt" USING btree ("visibility");

--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "active_stream_id" varchar(255);
