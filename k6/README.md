# k6 Load Testing

Performance testing infrastructure for Convocados using [k6](https://grafana.com/docs/k6/latest/).

## Prerequisites

Install k6 locally:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Test Types

| Script | VUs | Duration | Purpose |
|--------|-----|----------|---------|
| `smoke.js` | 5 | 30s | Quick validation on PRs |
| `load.js` | 1000 | ~17min | Normal production traffic |
| `stress.js` | 1500 | ~15min | Find breaking points |
| `spike.js` | 100→1000 | ~10min | Sudden traffic bursts |
| `sse.js` | 50 + 10 | ~60s | SSE connection stress + concurrent API |

## Running Locally

Start the app first, then run a test:

```bash
npm run dev  # in one terminal

# in another terminal
npm run k6:smoke
npm run k6:load
npm run k6:stress
npm run k6:spike
npm run k6:sse
```

Override the target URL:

```bash
K6_BASE_URL=https://staging.example.com npm run k6:smoke
```

## SLOs (Service Level Objectives)

| Metric | Target |
|--------|--------|
| HTTP error rate | < 1% |
| p95 response time (reads) | < 300ms |
| p95 response time (writes) | < 800ms |
| p95 response time (overall) | < 500ms |
| Check pass rate | > 99% |

## CI/CD

The `performance.yml` workflow runs:
- **Smoke test**: On PRs that touch `k6/` or `src/pages/api/`
- **Load test**: Weekly (Sunday 2am) + manual dispatch
- **Stress/Spike**: Manual dispatch only (`workflow_dispatch`)

Trigger manually from GitHub Actions → Performance Tests → Run workflow.

## Directory Structure

```
k6/
├── scripts/
│   ├── smoke.js      # Quick validation (5 VUs, 30s)
│   ├── load.js       # Normal load (1000 VUs, 17min)
│   ├── stress.js     # Beyond capacity (1500 VUs, 15min)
│   ├── spike.js      # Traffic bursts (100→1000 VUs)
│   └── sse.js        # SSE connections (50 VUs + 10 API)
├── config/
│   └── thresholds.js # Shared SLO thresholds
├── lib/
│   ├── helpers.js    # HTTP request wrappers
│   └── fixtures.js   # Test data generators
└── README.md
```
