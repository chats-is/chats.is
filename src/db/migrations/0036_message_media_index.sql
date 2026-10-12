-- The Library's index, rebuilt on the condition its query asks today, and
-- named for its columns. The one migration 0017 made by hand had fallen out
-- of step with the media tools, and no query could use it.
DROP INDEX IF EXISTS "message_library_media_idx";--> statement-breakpoint
CREATE INDEX "message_user_id_created_at_media_idx" ON "message" USING btree ("user_id","created_at" DESC NULLS FIRST) WHERE "message"."role" = 'assistant' and jsonb_path_exists("message"."parts", '$[*] ? (@.type == "file" || @.type like_regex "^tool-(generate_image|edit_image|generate_video|edit_video|text_to_speech)$")');