# Specialised agents are read-only Explorers, not worker pools

Design, Bugs, Security, and Performance are separate *Explorers* that file well-evidenced
Issues. They are not separate implementation workers, and they never open a Change. The
single Factory builds whatever a human marks `ready-for-agent`.

The obvious alternative was four specialised workers, one per focus. It was rejected for a
concrete reason: the factory runs one Change at a time, so four worker queues means three of
them starve permanently — or the factory moves to four concurrent runs, four worktrees, and
four sets of Gradle builds. The cost is fixed regardless of how the work is labelled.

The deeper reason is that what distinguishes a security change from a design change is the
*check*, not the implementation. Both are "make the Gate pass". So specialisation belongs in
the Explorer that proposes the work and in the Reviewer's lens that judges it, while the
implementation loop stays single and boring. Explorers are also the cheap half: they are
read-only, run on a schedule, and cost no CI time at all.

One asymmetry is accepted rather than solved. The Performance Explorer earns its extra
budget by prototyping and discarding its work, because there the number *is* the claim and an
unreachable Target wastes a whole Factory Budget. The Design Explorer has no equivalent, and
no machine-checkable Gate at all — its Issues rest on argument, and the Reviewer's
"does this add ceremony?" lens is the only real check. That is the weakest link in the
system and it stays weak on purpose rather than being dressed up as a metric.
