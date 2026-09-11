-- Video editing is a capability of its own: a model that can animate an image
-- (supports_edit) cannot necessarily edit a video, and vice versa. Hand-written
-- rather than generated so the existing flag is left untouched.
ALTER TABLE "model" ADD COLUMN "supports_video_edit" boolean DEFAULT false;
