-- What the prompt's model now says, its labels said: the providers, which
-- named nothing, and the list of models, whose first is the model it keeps.
ALTER TABLE "prompt" DROP COLUMN "providers";--> statement-breakpoint
ALTER TABLE "prompt" DROP COLUMN "models";