-- 0021 renamed chat.active_stream_id to stream_id, but a database first
-- migrated by the Next.js branch never ran it: that branch's 0020 carries a
-- later timestamp than this branch's 0020 and 0021, and drizzle-kit only
-- applies migrations newer than the last one recorded. The rename is made
-- here when the old column is still there, and is nothing where 0021 ran.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'chat'
      AND column_name = 'active_stream_id'
  ) THEN
    ALTER TABLE "chat" RENAME COLUMN "active_stream_id" TO "stream_id";
  END IF;
END $$;
