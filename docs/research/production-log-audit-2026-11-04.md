# Production log audit — 4 November 2026

## Scope and limits

Read-only inspection of Fly apps `convocados` and `convocados-scheduler`, their
retained stdout/stderr, machine state, `/api/health`, and aggregate job state.
No production data, configuration, jobs or deployments were changed. A single
read-only Playtomic search was made from the running web machine.

Requested: the previous seven days. The earliest returned web log was
**2026-10-29 00:00:00 UTC**, and the earliest scheduler log was **29 October
00:03:45 UTC**. The requested part of 28 October was not returned; it is not
covered by this audit. Logs were collected through **4 November 17:28 UTC**
(web) and **17:23 UTC** (scheduler). Lisbon is UTC for these dates.

Collection used the historical logs HTTP endpoint with forward cursor pagination,
not only the 100 recent entries returned by `fly logs --no-tail`. The final
collection contained **52,630 web events and 2,859 scheduler events**. Overlapping
collection windows were deduplicated by timestamp, instance and message. Raw
logs remain outside the repository because they can contain personal data.
This is application log coverage, not a complete HTTP access log or proof that
all user journeys succeeded.

## Findings, in priority order

### 1. No active off-host database replication — existing issue #1487

There were **32,933** `NotEntitled` error messages between 29 October 00:00 UTC
and 1 November 13:15 UTC. Litestream could not list objects in Cloudflare R2:
`403 NotEntitled: Please enable R2 through the Cloudflare Dashboard`.

At inspection time both deployed configuration and health explicitly reported
backups disabled (`BACKUPS_ENABLED=false`, `litestream.enabled=false`). The error
spam stopping is therefore not evidence of restored replication. A local
`/data/db.sqlite.pre-migrate-backup` is made at startup; it is on the same volume
and is not an off-host recovery copy.

[Existing issue #1487](https://github.com/Cabeda/Convocados/issues/1487) already
tracks this. Restore a supported off-host target and verify a fresh replica and
recovery before treating it as fixed. No duplicate issue was filed.

Mission: Simple to run / Management-free — protect the organizer's game data.

### 2. Pickup discovery cannot resolve the upstream hostname — issue #1693

**16** scheduler sweep reports between 29 October 09:00 UTC and 4 November
09:00 UTC returned zero clubs and zero created pickups, with search errors
across all 20 sport/city combinations for Porto and Lisbon. The web app has
matching sweep reports; those are the same executions, not additional failures.

A read-only search from the production web machine reproduced:

```text
TypeError: fetch failed
cause.code: ENOTFOUND
cause.hostname: api.playtomic.io
cause.message: getaddrinfo ENOTFOUND api.playtomic.io
```

`src/lib/playtomic.server.ts` hardcodes this host and retains only the outer
`fetch failed` message. The cron route unconditionally returns `ok: true`, and
the scheduler reports completion even when every search failed. This hides the
functional outage behind successful HTTP responses.

[Issue #1693](https://github.com/Cabeda/Convocados/issues/1693) covers upstream
verification, useful error causes, and honest degraded reporting with regression
tests. DNS failure is reproduced; whether the upstream host is retired or DNS is
failing specifically on Fly is not established. Do not replace it speculatively.

Mission: Fun and engaging / Simple to run — restore automatic places-to-play discovery.

### 3. Auth requests share a fallback rate-limit bucket — issue #1692

**30** Better Auth warnings from 29 October 10:45 UTC to 4 November 16:50 UTC:

```text
Rate limiting could not determine a client IP and is falling back to a
single shared per-path bucket.
```

`src/lib/auth.server.ts` enables production per-IP limits but does not configure
`advanced.ipAddress`. This risks unrelated users exhausting the same auth-path
quota. The warning proves fallback; these logs do not prove a legitimate user
was actually blocked.

[Issue #1692](https://github.com/Cabeda/Convocados/issues/1692) requires a trusted
Fly client-address configuration and tests for separate users, actual throttling,
and spoofed forwarded headers. No limiter or security boundary was changed.

Mission: Simple to run / Management-free — keep sign-in reliable as usage grows.

## Other observations

- **37** failed health-check messages and **14** connection-refused messages were
  observed. The inspected startup sequences recover after deployment; today's
  16:20:25 failed check became passing at 16:20:36. The web app has one active
  machine and a local SQLite volume. This creates deployment interruptions;
  these counts do not establish their full duration or affected request count.
  Adding a second independent SQLite writer would not be a safe quick fix.
- Fly blocked five `rsc_exploit_attempt` requests. Invalid-authority, missing-host,
  unsupported-method and disconnected-client messages also appear. They do not
  establish an application vulnerability or a legitimate-user defect.
- One OAuth state-verification error occurred on 3 November at 10:05 UTC. Six
  `User not found` warnings occurred on 31 October around 04:05–04:06 UTC. There
  is insufficient context to distinguish abandoned/invalid login attempts from
  a reproducible defect; no speculative issue was filed.
- One malformed SSH command on 31 October was an inspection-tool error, not an
  application failure.

## Current health and persistent queue evidence

Production version: **3.271.11**. Web health check passing; database writable in
WAL mode; scheduler heartbeat running; cumulative scheduled dead-letter count 0.
One scheduler machine runs and its configured standby is stopped, as expected.

| Queue | Retained rows | Created in last seven days | Dead-lettered in last seven days | Pending |
|---|---:|---:|---:|---:|
| ScheduledJob | 650 | 34 | 0 | 28 |
| NotificationJob | 1,634 | 83 | 0 | 0 |

No ScheduledJob had a non-null `lastError`. Recent scheduled jobs were not more
than five minutes overdue. Two pending backfill jobs have `retryCount=2`, but no
recorded current error or overdue execution; retry counts alone are not evidence
of a current failure. Successful retries and pruned rows limit historical inference.

## Handoff

Address #1487, #1693 and #1692 in that order. The latter two are filed without
`ready-for-agent`; only Cabeda can offer them to the factory. This audit changes
only documentation and the issue ledger. It does not implement or deploy fixes.

The production-inspection runbook has been corrected: Fly does retain historical
logs. See [Fly log search](https://docs.fly.io/monitoring/search-logs) and the
[logs API guide](https://docs.fly.io/monitoring/logs-api-options).
