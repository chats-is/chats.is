-- The install-wide system prompt is not a default the model's own prompt
-- replaces — the two are joined, this one first — so its key no longer says
-- "default". Safe to run again: a row already renamed matches nothing.
UPDATE "setting" SET "key" = 'chat.systemPrompt' WHERE "key" = 'default.chat.systemPrompt' AND NOT EXISTS (SELECT 1 FROM "setting" WHERE "key" = 'chat.systemPrompt');
