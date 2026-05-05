# Convocados Scheduler Worker

A lightweight polling worker that processes scheduled jobs from the Convocados web app.

## Architecture

```
┌─────────────────────┐      GET /api/internal/jobs/due      ┌──────────────┐
│  Scheduler Worker   │  ──────────────────────────────────> │  Web App     │
│  (this app)         │                                      │  (SQLite)    │
│                     │  <────────────────────────────────── │              │
│  - Polls every 10s  │      { jobs: [...] }                 │              │
│  - Processes jobs   │                                      │              │
│    sequentially     │  POST /api/internal/jobs/:id/process │              │
└─────────────────────┘  ──────────────────────────────────> └──────────────┘
```

## Deployment

1. Set the `SCHEDULER_SECRET` secret (must match the web app's `SCHEDULER_SECRET`):
   ```bash
   fly secrets set SCHEDULER_SECRET=your-secret -a convocados-scheduler
   ```

2. Deploy:
   ```bash
   fly deploy
   ```

## Development

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_URL` | Yes | `https://convocados.fly.dev` | Web app base URL |
| `SCHEDULER_SECRET` | Yes | — | Shared secret for internal API auth |
| `POLL_INTERVAL_MS` | No | `10000` | Polling interval in milliseconds |
