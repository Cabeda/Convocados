# 🏆 Convocados

**Organize pickup sports games in seconds** — create events, find courts, randomize fair teams, track scores, and notify players.

[![CI](https://github.com/Cabeda/Convocados/actions/workflows/ci.yml/badge.svg)](https://github.com/Cabeda/Convocados/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

🌐 **[Live Demo](https://convocados.cabeda.dev)** · 📖 **[Docs](https://convocados.cabeda.dev/docs)** · 📱 **[Android App](https://play.google.com/store/apps/details?id=com.cabeda.convocados)**

---

## Why Convocados?

Most sports organizers use a WhatsApp group and a spreadsheet. Convocados replaces both with a single shareable link — and adds features you can't get elsewhere:

- **🔍 Court Finder** — Search nearby courts via Playtomic, compare prices across venues, and get notified when a booked court frees up. No more manually refreshing booking apps.
- **🎲 Fair Teams** — ELO-balanced team randomization so games aren't one-sided
- **🔄 Recurring Games** — Auto-resets weekly/monthly. Players just tap "I'm in" each week
- **💰 Split Costs** — Track who owes what, with payment nudges and enforcement gates
- **📊 Game History** — Scores, MVP votes, attendance streaks across your group

![Dashboard](./docs/screenshots/web/03-dashboard.png)

---

## Features

### 🏟️ Court Finder & Availability Alerts

| Search nearby | Map view | Notify when free |
|---|---|---|
| Search 15+ Playtomic clubs by distance, price, time | Toggle between list and map | Watch a booked court and get push-notified when it opens |

- Searches multiple sport variants (FUTSAL + FOOTBALL_OTHERS for 5-a-side)
- Groups results by club with clickable time-slot chips showing prices
- Deep links open Playtomic with the correct sport, date, and court pre-selected
- Recurring watches (e.g. "every Monday 18–20h") with smart deduplication
- Availability cached and batch-fetched (scales to hundreds of watches)

### Core Features

| Feature | Description |
|---------|-------------|
| 🎯 Create events | Set sport, date, location, max players — share a single link |
| 👥 Player management | Sign-up, bench overflow, drag-to-reorder, claimed slots |
| 🎲 Team randomizer | Random or ELO-balanced teams with one click |
| 📈 ELO ratings | Track player skill across games with auto-calculated ratings |
| 🔄 Recurring games | Weekly/monthly auto-reset with customizable recurrence rules |
| 📜 Game history | Editable scores, MVP votes, attendance tracking |
| 💰 Cost splitting | Per-player cost assignment with payment status tracking |
| 🔔 Push notifications | Web Push + native mobile when players join/leave |
| 🌍 Public events | Browse open games with filters, table view, and Leaflet map |
| 🔗 Webhooks | HTTP callbacks for all event lifecycle events |
| 🔐 OAuth 2.1 / OIDC | Full provider with PKCE, magic link, Google SSO, MCP-ready |
| 📱 Android app | Native Kotlin + Jetpack Compose (phone + Wear OS) |

---

## Screenshots

### Web

| Landing | Dashboard | Event detail |
|---------|-----------|--------------|
| ![Landing](./docs/screenshots/web/01-landing.png) | ![Dashboard](./docs/screenshots/web/03-dashboard.png) | ![Event](./docs/screenshots/web/04-event-detail.png) |

| Rankings | History | Public games |
|----------|---------|--------------|
| ![Rankings](./docs/screenshots/web/06-event-rankings.png) | ![History](./docs/screenshots/web/05-event-history.png) | ![Public](./docs/screenshots/web/11-public-games.png) |

### Mobile (Android)

| Games | Event detail | Stats | Profile |
|-------|-------------|-------|---------|
| ![Games](./docs/screenshots/mobile/01-games-tab.png) | ![Event](./docs/screenshots/mobile/02-event-detail.png) | ![Stats](./docs/screenshots/mobile/04-stats.png) | ![Profile](./docs/screenshots/mobile/05-profile.png) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Astro 6](https://astro.build) (SSR, Node adapter) |
| UI | React 19 + [MUI 6](https://mui.com) |
| Auth | [better-auth](https://better-auth.com) (OAuth 2.1 / OIDC) |
| Database | SQLite via [Prisma 6](https://prisma.io) (WAL mode, Litestream backups) |
| Testing | Vitest (96%+ coverage) + E2E |
| Mobile | Native Android — Kotlin + Jetpack Compose |
| Deployment | Docker on [Fly.io](https://fly.io) |
| Court data | [Playtomic](https://playtomic.io) public API |

---

## Quick Start

```bash
git clone https://github.com/Cabeda/Convocados.git
cd Convocados
npm ci
npx prisma generate
npx prisma db push
npm run dev
```

Open `http://localhost:4321` — create your first game in 10 seconds.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run test` | Run tests (Vitest) |
| `npm run typecheck` | TypeScript type checking |
| `npm run db:migrate` | Create & apply DB migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed 100 sample events |

---

## Contributing

Contributions welcome! The project uses TDD with strict pre-push hooks (lint + typecheck + tests must pass). See [AGENTS.md](./AGENTS.md) for the full development workflow and [contributing guide](https://convocados.cabeda.dev/docs/guides/contributing).

Good first issues are labeled [`good first issue`](https://github.com/Cabeda/Convocados/labels/good%20first%20issue).

---

## Documentation

Full docs at [`/docs`](https://convocados.cabeda.dev/docs):

- [Getting started](https://convocados.cabeda.dev/docs/quickstart)
- [Feature guides](https://convocados.cabeda.dev/docs/features/events) (events, teams, court finder, payments, etc.)
- [API reference](https://convocados.cabeda.dev/docs/api)
- [Self-hosting](https://convocados.cabeda.dev/docs/guides/self-hosting)

---

## License

MIT
