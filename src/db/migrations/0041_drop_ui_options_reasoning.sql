-- A chat model no longer offers a Think switch — the thinking is always sent
-- and shown — so the option that decided whether it did goes, and a model
-- still carrying it would be refused the next time it is saved. Safe to run
-- again: a model without the key matches nothing.
UPDATE "model" SET "ui_options" = "ui_options" - 'reasoning' WHERE "ui_options" ? 'reasoning';
