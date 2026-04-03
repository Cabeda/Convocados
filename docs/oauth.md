# OAuth 2.1 / OIDC Provider

Convocados acts as a full OAuth 2.1 / OIDC provider powered by [better-auth](https://better-auth.com). Third-party apps and the mobile client authenticate via standard Authorization Code + PKCE flow.

## Authentication methods

| Method | Description |
|--------|-------------|
| Email + password | Standard sign-up with email verification |
| Magic link | Passwordless — click a link sent to your inbox |
| Google SSO | OAuth via Google |
| OIDC (for apps) | Authorization Code + PKCE for third-party clients |

## OIDC endpoints

All endpoints are served under `/api/auth`:

| Endpoint | Path |
|----------|------|
| Discovery | `/.well-known/openid-configuration` |
| Authorization | `/api/auth/oauth2/authorize` |
| Token | `/api/auth/oauth2/token` |
| Userinfo | `/api/auth/oauth2/userinfo` |
| Introspect | `/api/auth/oauth2/introspect` |
| Revoke | `/api/auth/oauth2/revoke` |
| JWKS | `/api/auth/jwks` |

## Scopes

| Scope | Description |
|-------|-------------|
| `openid` | Verify identity |
| `profile` | Basic profile info |
| `email` | Email address |
| `offline_access` | Refresh tokens |
| `read:events` | View events |
| `write:events` | Modify event settings |
| `create:events` | Create new events |
| `manage:players` | Add/remove players |
| `read:ratings` | View ELO ratings |
| `read:history` | View game history |
| `manage:teams` | Randomize and assign teams |
| `manage:webhooks` | Manage webhooks |
| `manage:push` | Manage push subscriptions |
| `read:calendar` | Access calendar feeds |
| `manage:payments` | Manage costs and payments |

## Registering a client

Clients can be registered dynamically via the OIDC dynamic registration endpoint, or pre-configured as a trusted client via environment variables.

### Trusted clients (skip consent screen)

Trusted clients are for non-browser flows (mobile apps, CLI tools) that cannot handle the interactive consent redirect. Set these env vars:

```bash
TRUSTED_OAUTH_CLIENT_ID=my-app
TRUSTED_OAUTH_CLIENT_SECRET=my-secret
TRUSTED_OAUTH_REDIRECT_URIS=myapp://callback,https://oauth.usebruno.com/callback
```

The secret is stored hashed (SHA-256 → base64url). Trusted clients skip the consent screen automatically.

## Authorization Code + PKCE flow

```
1. Generate code_verifier (random 43-128 char string)
2. code_challenge = BASE64URL(SHA256(code_verifier))

3. GET /api/auth/oauth2/authorize
     ?client_id=<id>
     &redirect_uri=<uri>
     &response_type=code
     &scope=openid profile read:events
     &code_challenge=<challenge>
     &code_challenge_method=S256
     &state=<random>

4. User signs in → redirected to redirect_uri?code=<code>&state=<state>

5. POST /api/auth/oauth2/token
     grant_type=authorization_code
     &code=<code>
     &redirect_uri=<uri>
     &client_id=<id>
     &client_secret=<secret>
     &code_verifier=<verifier>

6. Response: { access_token, refresh_token, id_token, expires_in }
```

Plain `code_challenge_method=plain` is not supported — S256 is required.

## Token lifetimes

| Token | Lifetime |
|-------|----------|
| Access token | 1 hour |
| Refresh token | 7 days |
| Authorization code | 10 minutes |

## Refreshing tokens

```bash
POST /api/auth/oauth2/token
  grant_type=refresh_token
  &refresh_token=<token>
  &client_id=<id>
  &client_secret=<secret>
```

## Revoking tokens

```bash
POST /api/auth/oauth2/revoke
  token=<access_or_refresh_token>
  &client_id=<id>
  &client_secret=<secret>
```

## Local callback endpoint (testing only)

`GET /api/oauth-callback` returns the authorization code as JSON instead of redirecting. This is used by Bruno CLI tests to capture the code without a browser.

```json
{ "code": "abc123", "state": "xyz" }
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_URL` | Base URL of the app (default: `http://localhost:4321`) |
| `BETTER_AUTH_SECRET` | Secret key for signing tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `TRUSTED_OAUTH_CLIENT_ID` | Trusted client ID (optional) |
| `TRUSTED_OAUTH_CLIENT_SECRET` | Trusted client secret (optional) |
| `TRUSTED_OAUTH_REDIRECT_URIS` | Comma-separated redirect URIs for trusted client |
| `TRUSTED_ORIGINS` | Comma-separated extra allowed CORS origins |
