-- Accounts made by an email-code sign-in were stored with an empty name, and
-- go by their address's local part, as 0020 named the accounts before them
-- and as new ones now are named when they are created.
UPDATE "user" SET "name" = split_part("email", '@', 1) WHERE btrim("name") = '';
