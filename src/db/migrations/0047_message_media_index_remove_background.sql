-- The Library's index, rebuilt on the condition its query asks now that
-- remove_background makes images too.
DROP INDEX "message_user_id_created_at_media_idx";--> statement-breakpoint
CREATE INDEX "message_user_id_created_at_media_idx" ON "message" USING btree ("user_id","created_at" DESC NULLS FIRST) WHERE "message"."role" = 'assistant' and jsonb_path_exists("message"."parts", '$[*] ? (@.type == "file" || @.type like_regex "^tool-(generate_image|edit_image|remove_background|generate_video|edit_video|text_to_speech)$")');