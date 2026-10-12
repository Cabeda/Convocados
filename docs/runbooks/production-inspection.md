# Inspecting Production

How to answer "what is production actually doing?" without guessing. Covers the
database, the job queue, the scheduler, and logs — plus the two traps that cost
a debugging session: the production image has **no `sqlite3` CLI**, and logs are
**not retained**.

## Where things run

| Process | Fly app | Owns |
|---|---|---|
| Web app | `convocados` | the SQLite database at `/data/db.sqlite`, Litestream, and **all** job execution |
| Scheduler worker | `convocados-scheduler` | nothing but the poll loop — it calls the web app |

The scheduler is a **dumb poller**: it fetches due jobs and asks the web app to
process them (`scheduler/index.ts` → `POST /api/internal/jobs/:id/process`).
Job side effects therefore run **inside the web app**, so job errors appear in
the **web app's** logs, not the scheduler's. Looking at `convocados-scheduler`
logs for a job failure is a dead end.

## Read-only database queries

Use the wrapper — it opens `better-sqlite3` in readonly mode over `fly ssh`, and
refuses anything that is not `SELECT` / `PRAGMA` / `WITH`:

```bash
scripts/prod-query.sh "SELECT type, count(*) c FROM ScheduledJob GROUP BY type"
scripts/prod-query.sh "SELECT id, type, failedAt, lastError FROM ScheduledJob WHERE failedAt IS NOT NULL ORDER BY failedAt DESC"
```

Do **not** run bare `sqlite3` over `fly ssh console` — the binary is not in the
image (`executable file not found`); that is the trap the wrapper exists to
avoid. Never copy `/data/db.sqlite` to your machine to "just query it" — it
holds user emails and other PII; query it where it lives, read-only.

## The scheduled-job queue

`ScheduledJob` rows carry the queue. Key fields and semantics:

- `type` — `reminder_24h` / `reminder_2h` / `reminder_1h` / `post_game` / `backfill_merged_identity`.
- `runAt` — when it becomes due (backoff pushes this forward on retry).
- `retryCount` — attempts so far; the 3rd failure dead-letters the job.
- `failedAt` — set on dead-letter. `lastError` carries the (truncated) reason, so a
  dead-letter is diagnosable from the row. Before `lastError` existed, the reason
  lived only in stdout — which is retained for minutes, not months.

Note that `countFailedJobs()` / `/api/health`'s `failedJobs` is **cumulative**: a
dead-letter row is never pruned, so the count includes fixes from long ago. Check
`lastError` and `failedAt` before treating any of it as live.

```bash
# Dead-letters with their reason, newest first:
scripts/prod-query.sh "SELECT type, datetime(failedAt/1000,'unixepoch') AS failed, lastError FROM ScheduledJob WHERE failedAt IS NOT NULL ORDER BY failedAt DESC"
```

Admin users also see the dead-letter list via `GET /api/admin/stats`
(`deadLetterJobs`); the public `/api/health` shows only the count and never
echoes internal error text.

## Logs

```bash
fly logs -a convocados           # live tail only — no history
fly logs -a convocados-scheduler # the poll loop; rarely what you want
```

Fly retains logs for a short window and the app has no error sink, so a failure
older than a few minutes is gone from logs. This is exactly why `ScheduledJob.lastError`
and `NotificationJob` dead-letter rows persist the reason on the row instead.

## Health

```bash
curl -s https://convocados.cabeda.dev/api/health | jq
```

Reports DB mode/size, Litestream status, and `scheduler: { running, failedJobs }`.

## Related

- [Disaster recovery](../disaster-recovery.md) — restoring the database.
- [Point-in-time recovery](./point-in-time-recovery.md), [full recovery from zero](./full-recovery-from-zero.md).
