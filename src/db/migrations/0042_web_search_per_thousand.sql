-- A web search is priced per thousand, as providers quote it, where it was
-- priced one by one: the price kept on each model, and the one each usage row
-- recorded when it was billed, are a thousand times what they were, so every
-- cost already charged reads the same. Runs once, as every migration does;
-- run again, it would multiply again.
UPDATE "model_pricing" SET "web_search" = "web_search" * 1000 WHERE "web_search" IS NOT NULL;--> statement-breakpoint
UPDATE "usage" SET "web_search_price" = "web_search_price" * 1000 WHERE "web_search_price" IS NOT NULL;
