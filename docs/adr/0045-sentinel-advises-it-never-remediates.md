# The Sentinel advises; it never remediates

The Sentinel watches production and, on unhealthy signals, files the incident, drafts the
postmortem, and pages a human. It holds no authority to change production: no scale, no
restart, no rollback, no deploy, no migration. This was chosen explicitly over a bounded
remediation scope (the obvious first candidate being "scale up, which is cheap and
reversible").

The cost of this choice is real and accepted: when production is down, the response is bound
by how fast a human wakes up, and the Sentinel cannot shorten that. The benefit is that
there is exactly one blast-radius rule instead of a list of them, and no incident can ever
be the result of a judgement call made at 4am by a model that has never seen that failure
before. An advisory Sentinel that is wrong costs a wasted night; a remediating Sentinel that
is wrong costs a restore from `docs/runbooks/`, which is a worse trade at this size.

Two related decisions ride along. The Sentinel's most valuable check is disk headroom on the
`football_data` volume, not CPU latency: that volume is 1GB of SQLite in WAL mode with
Litestream replication, and a full volume means failing writes, which is data loss rather
than slowness. And the Sentinel must learn that `auto_stop_machines = "suspend"` means a
suspended app is the healthy idle state — a Sentinel that pages on it nightly gets muted,
and a muted Sentinel is worse than none.
