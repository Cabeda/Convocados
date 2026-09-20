# Rotating `BETTER_AUTH_SECRET`

Rotating the auth secret invalidates every existing session (expected). Two
things must be true for sign-in to keep working afterwards:

1. **JWKS self-heal** — better-auth's `jwt()` plugin encrypts the JWKS signing
   key at rest with the auth secret. A key encrypted with a secret that is no
   longer configured cannot be decrypted, and every session lookup 500s with
   `Failed to decrypt private key`. The app deletes such keys on first boot
   (`ensureAuthKeysHealthy` → `repairStaleJwks`), then better-auth mints a fresh
   key under the current secret. No manual step is required as long as the
   deployed code includes the guard.
2. **Versioned secrets** — to avoid invalidating JWKS on the *next* rotation,
   keep the previous secret(s) configured via `BETTER_AUTH_SECRETS`.

## Procedure

1. Generate a new secret (≥ 32 chars):
   ```sh
   openssl rand -base64 48
   ```
2. Set the versioned list in production, newest first. Keep the retiring secret
   as `BETTER_AUTH_SECRET` so pre-versioning ciphertext still decrypts:
   ```sh
   flyctl secrets set \
     BETTER_AUTH_SECRETS="2:<new-secret>,1:<current-secret>" \
     BETTER_AUTH_SECRET="<new-secret>"
   ```
3. Deploy. On boot the app drops any JWKS key it cannot decrypt and mints a new
   one. Users are logged out and sign in again; everything else continues.
4. After the deployment has been stable, drop the oldest version in a later
   rotation — `BETTER_AUTH_SECRETS="3:<newest>,2:<previous>"`.

## What you should NOT do

- Do **not** delete the `jwks` rows by hand while the guard is deployed; the
  guard does it safely on boot. Manual cleanup is only needed for a deployment
  that predates the guard:
  ```sh
  sqlite3 /data/db.sqlite "DELETE FROM jwks;"
  ```
- Do **not** rotate to a secret shorter than 32 chars, or one with low entropy.
