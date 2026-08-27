# Preview Deployments (Fly.io Review Apps)

Manual, per-PR preview environments. See [ADR 0022](../adr/0022-pr-preview-environments.md)
for the design rationale.

## How it works

| Action | Result |
|---|---|
| `/preview` comment on a PR | Deploys PR head to `https://convocados-pr-<N>.fly.dev` |
| `/preview` again later | Redeploys the latest head in place |
| `/preview-stop` | Destroys the preview early |
| PR closes | Preview destroyed automatically |

Previews use `.fly/preview.toml` (256mb machine, ephemeral disk, no volume,
boot-time migrations). The production `fly.toml` is untouched.

## Access

Only the repository owner and usernames listed in `.github/CODEOWNERS`
(usernames only) may request previews — **both** the PR author and whoever
types the command must qualify. To grant a contributor preview access, add
their handle to `.github/CODEOWNERS`.

## One-time setup

### 1. Fly token (`FLY_PREVIEW_TOKEN`)

Create a dedicated token so the prod deploy token is never used by previews:

```sh
fly tokens create "github-previews" --org personal --expiry 8760h
```

Store as repository secret `FLY_PREVIEW_TOKEN`. Note: app names are dynamic
(`convocados-pr-<N>`), so the token must be org-scoped rather than scoped to a
single app. Rotate yearly (expiry above).

### 2. Shared auth secret (`PREVIEW_BETTER_AUTH_SECRET`)

```sh
openssl rand -hex 32
```

Store as repository secret `PREVIEW_BETTER_AUTH_SECRET`. It is staged onto each
preview app as `BETTER_AUTH_SECRET`. One value is shared across previews; it is
not a production secret.

If either secret is missing the workflow fails fast with an explicit error.

## Cost profile

- Compute: $0 while idle (`auto_stop_machines = "suspend"`,
  `min_machines_running = 0`); shared-cpu-1x / 256mb while running.
- Storage: $0 (no volumes — SQLite on ephemeral disk).
- Lifetime: bounded by PR close (auto-destroy), or earlier via `/preview-stop`.

## Limitations

- Preview databases start **empty** (schema only). Seed manually via
  `fly ssh console -a convocados-pr-<N>` if needed.
- No Litestream replication, no email provider credentials, no OAuth provider
  secrets: sign-in with Google/email links will not fully work unless you add
  those secrets per-app. Treat previews as UI/API smoke environments.
- Never enter real credentials or personal data — preview data is ephemeral
  and not covered by backup procedures.
- Third-party OAuth apps (e.g. Google) need each preview origin allowlisted;
  by default they are not, so social sign-in redirects will fail.
