-- `supports_edit` meant two different things depending on `capability`: an
-- image model that can edit an image, a video model that can take one as its
-- opening frame. Split it so each capability says what it is. Hand-written
-- rather than generated: drizzle-kit resolves this shape interactively, and
-- would otherwise drop the column and take the admin's configuration with it.
ALTER TABLE "model" ADD COLUMN "supports_image_edit" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "supports_image_to_video" boolean DEFAULT false;--> statement-breakpoint
UPDATE "model" SET "supports_image_edit" = "supports_edit" WHERE "capability" = 'image';--> statement-breakpoint
UPDATE "model" SET "supports_image_to_video" = "supports_edit" WHERE "capability" = 'video';--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "supports_edit";
