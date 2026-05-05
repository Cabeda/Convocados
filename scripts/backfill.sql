-- Backfill scheduled reminder jobs for all existing future events.
-- Run this via: sqlite3 /data/football.db < backfill.sql
-- Or via flyctl ssh console: cat <<'SQL' | sqlite3 /data/football.db
-- ... SQL ...

-- 24h reminders
INSERT INTO ScheduledJob (id, eventId, type, payload, runAt, retryCount, createdAt)
SELECT
  lower(hex(randomblob(12))),
  e.id,
  'reminder_24h',
  '{}',
  datetime(e.dateTime, '-24 hours'),
  0,
  datetime('now')
FROM Event e
WHERE e.dateTime > datetime('now')
  AND e.id NOT IN (SELECT DISTINCT eventId FROM ScheduledJob WHERE eventId IS NOT NULL);

-- 2h reminders
INSERT INTO ScheduledJob (id, eventId, type, payload, runAt, retryCount, createdAt)
SELECT
  lower(hex(randomblob(12))),
  e.id,
  'reminder_2h',
  '{}',
  datetime(e.dateTime, '-2 hours'),
  0,
  datetime('now')
FROM Event e
WHERE e.dateTime > datetime('now')
  AND e.id NOT IN (SELECT DISTINCT eventId FROM ScheduledJob WHERE eventId IS NOT NULL);

-- 1h reminders
INSERT INTO ScheduledJob (id, eventId, type, payload, runAt, retryCount, createdAt)
SELECT
  lower(hex(randomblob(12))),
  e.id,
  'reminder_1h',
  '{}',
  datetime(e.dateTime, '-1 hours'),
  0,
  datetime('now')
FROM Event e
WHERE e.dateTime > datetime('now')
  AND e.id NOT IN (SELECT DISTINCT eventId FROM ScheduledJob WHERE eventId IS NOT NULL);

-- post-game reminders (only for events with durationMinutes > 0)
INSERT INTO ScheduledJob (id, eventId, type, payload, runAt, retryCount, createdAt)
SELECT
  lower(hex(randomblob(12))),
  e.id,
  'post_game',
  '{}',
  datetime(e.dateTime, '+' || e.durationMinutes || ' minutes'),
  0,
  datetime('now')
FROM Event e
WHERE e.dateTime > datetime('now')
  AND e.durationMinutes > 0
  AND e.id NOT IN (SELECT DISTINCT eventId FROM ScheduledJob WHERE eventId IS NOT NULL);
