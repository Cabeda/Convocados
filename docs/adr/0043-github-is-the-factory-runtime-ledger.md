# GitHub is the factory's runtime ledger; dex stays the planning ledger

The factory keeps all of its runtime state in GitHub — labels, claim comments, transcripts
— rather than in the repository's dex task file. dex is authoritative for human planning
(`.dex/tasks.jsonl`, synced to GitHub Issues); GitHub labels are authoritative for the
queue, the Claim, the Handoff, and Blocked.

The deciding factor is that the factory cannot write to dex. `dex` is a local CLI and is not
installed on the GitHub runner, so a machine-written issue could never be a dex task. Since
the ledger has to be something a stateless event-triggered run can read and write, and
since GitHub is also the only surface that emits the webhooks the factory reacts to, GitHub
wins. Two ledgers with one owner each is manageable; two writers on one ledger is not.

The cost is a documented exception to the "use dex for ALL task tracking" rule: Explorers
and the Sentinel file GitHub issues labelled `factory:explored`, and humans keep dex.
Promotion to `ready-for-agent` is always a human action, so the planning ledger stays under
human control even though the runtime ledger does not.
