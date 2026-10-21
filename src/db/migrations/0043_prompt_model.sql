ALTER TABLE "prompt" ADD COLUMN "type" varchar(20) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "needs_reference" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "model_id" varchar(255);--> statement-breakpoint
-- A prompt names the one model it is tried on by default, where it held a
-- list of labels nothing acted on: the first of them, if it is a model there
-- is. Its kind is what the prompt is for, and a model that transcribes works
-- from the audio it is given.
UPDATE "prompt" SET "model_id" = "model"."model_id", "type" = "model"."capability", "needs_reference" = coalesce("model"."supports_transcription", false) FROM "model" WHERE jsonb_typeof("prompt"."models") = 'array' AND jsonb_array_length("prompt"."models") > 0 AND "model"."model_id" = "prompt"."models"->>0;
