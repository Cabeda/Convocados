# Context Map

Convocados has two bounded contexts. They share a repository, a database, and a git
history, and almost nothing else. The vocabulary of one is meaningless — and actively
misleading — in the other.

## Contexts

- [Convocados](./CONTEXT.md): the sports-event domain — Events, Games, Players, Payments,
  Seasons, Skill Ratings. What the product *is*.
- [Delivery Factory](./docs/factory/CONTEXT.md): the automation that builds and reviews
  Changes and files Issues. How the product *gets made*. Vocabulary, gates, budgets, and
  states live there.

## Why they are separate

The collision is not hypothetical. "Event" in the product is a recurring series of games
that people turn up to; "Event" in a CI system is a thing that happened once. "Player" is
somebody on a roster; "Player" in an agent system is the model doing the work. "Ready" means
a Game is settled in one context and a Change is awaiting a human in the other.

Keeping one glossary for both would guarantee that sentences like "the factory reviewed the
event" keep getting written, and that they keep meaning whatever the author had in mind
that afternoon. So `CONTEXT.md` at the repo root stays purely the product domain, and the
factory's terms are defined in their own file. Neither file references an implementation
detail of the other.

## Relationships

- **Delivery Factory → Convocados**: a Change built in one context lands in the other. The
  Factory reads this repo's Mission and Core Principles as its acceptance criteria; it
  owns nothing in the product domain.
- **Convocados → Delivery Factory**: one direction only, and only as *input*. The product
  context never depends on the factory — the app builds, tests, ships, and runs with the
  factory entirely absent. The factory being broken must never be a production incident.
- **Shared vocabulary**: the *Mission* (one question, three pillars) is deliberately shared
  language. It is the yardstick both contexts measure against, and the one place where a
  single term ("simple to run") must mean the same thing to a reviewer and to a designer.
  It is defined in `AGENTS.md`, not in either glossary, because it is a policy rather than
  a domain term.

## Conventions

- Product-domain terms are added to [CONTEXT.md](./CONTEXT.md); automation terms go to
  [docs/factory/CONTEXT.md](./docs/factory/CONTEXT.md). Ask "is this a thing in the app, or
  a thing about making the app?" before writing a definition.
- Decisions that span both contexts are system-wide ADRs in `docs/adr/`.
- `AGENTS.md` holds the constitution for both: Mission, Core Principles, and the Delivery
  Factory contract. Per-role runbooks live in `docs/factory/`.
