-- GamePayment rows used to be created for every active participant, including
-- bench players who never played. A game's authoritative "who played" record is
-- its frozen lineup (GameHistory.teamsSnapshot). Soft-archive pending rows for
-- players absent from that lineup so they stop surfacing as debtors in the
-- post-game banner, the history detail, and the payments page.
--
-- Paid rows are left untouched: money already changed hands and the wallet
-- ledger credits (payment_received) must stay reconcilable with the row.
UPDATE "GamePayment"
SET "archivedAt" = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE "archivedAt" IS NULL
  AND "status" <> 'paid'
  AND EXISTS (
    SELECT 1
    FROM "Game" g
    JOIN "GameHistory" gh ON gh."eventId" = g."eventId" AND gh."dateTime" = g."dateTime"
    WHERE g."id" = "GamePayment"."gameId"
      AND gh."teamsSnapshot" IS NOT NULL
      AND json_valid(gh."teamsSnapshot")
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Game" g
    JOIN "GameHistory" gh ON gh."eventId" = g."eventId" AND gh."dateTime" = g."dateTime"
    JOIN json_each(gh."teamsSnapshot") AS team
    JOIN json_each(team.value, '$.players') AS player
    WHERE g."id" = "GamePayment"."gameId"
      AND json_valid(gh."teamsSnapshot")
      AND json_extract(player.value, '$.name') = "GamePayment"."playerName"
  );
