/**
 * OpenAPI 3.1 specification for the Convocados API.
 * Kept as a plain object so it can be served as JSON and validated in tests.
 */

const eventIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string" },
  description: "Event ID",
};

const errorResponses = {
  "400": { description: "Bad request" },
  "401": { description: "Unauthorized" },
  "403": { description: "Forbidden" },
  "404": { description: "Not found" },
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Convocados API",
    version: "3.5.0",
    description: "API for organizing pickup sports games — manage events, players, teams, and more.",
    license: { name: "MIT" },
  },
  servers: [
    { url: "https://convocados.fly.dev", description: "Production" },
    { url: "http://localhost:4321", description: "Local development" },
  ],
  paths: {
    "/api/health": {
      get: {
        summary: "Health check",
        tags: ["System"],
        responses: { "200": { description: "Service is healthy" } },
      },
    },

    // ── Events ──────────────────────────────────────────────────────────
    "/api/events": {
      get: {
        summary: "List events (authenticated user's events)",
        tags: ["Events"],
        responses: { "200": { description: "List of events" } },
      },
      post: {
        summary: "Create a new event",
        tags: ["Events"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "dateTime"],
                properties: {
                  title: { type: "string" },
                  location: { type: "string" },
                  dateTime: { type: "string", format: "date-time" },
                  maxPlayers: { type: "integer", default: 10 },
                  sport: { type: "string", default: "football-5v5" },
                  teamOneName: { type: "string", default: "Ninjas" },
                  teamTwoName: { type: "string", default: "Gunas" },
                  isRecurring: { type: "boolean" },
                  recurrenceRule: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Event created" },
          ...errorResponses,
        },
      },
    },
    "/api/events/public": {
      get: {
        summary: "List public events",
        tags: ["Events"],
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" }, description: "Filter by sport" },
          { name: "hasSpots", in: "query", schema: { type: "boolean" }, description: "Only events with available spots" },
        ],
        responses: { "200": { description: "List of public events" } },
      },
    },
    "/api/events/{id}": {
      get: {
        summary: "Get event details",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: {
          "200": { description: "Event details with players and teams" },
          "404": { description: "Event not found" },
        },
      },
    },
    "/api/events/{id}/title": {
      put: {
        summary: "Update event title",
        tags: ["Events"],
        parameters: [eventIdParam],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" } } } } } },
        responses: { "200": { description: "Title updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/location": {
      put: {
        summary: "Update event location",
        tags: ["Events"],
        parameters: [eventIdParam],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { location: { type: "string" } } } } } },
        responses: { "200": { description: "Location updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/sport": {
      put: {
        summary: "Update event sport",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Sport updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/visibility": {
      put: {
        summary: "Toggle event public/private visibility",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Visibility updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/balanced": {
      put: {
        summary: "Toggle balanced teams mode",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Balanced mode updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/team-names": {
      put: {
        summary: "Update team names",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Team names updated" }, ...errorResponses },
      },
    },
    "/api/events/{id}/claim": {
      post: {
        summary: "Claim ownership of an event",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Ownership claimed" }, ...errorResponses },
      },
    },
    "/api/events/{id}/transfer": {
      post: {
        summary: "Transfer event ownership",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Ownership transferred" }, ...errorResponses },
      },
    },
    "/api/events/{id}/status": {
      get: {
        summary: "Get event status (player count, spots left)",
        tags: ["Events"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Event status" } },
      },
    },

    // ── Players ─────────────────────────────────────────────────────────
    "/api/events/{id}/players": {
      post: {
        summary: "Add a player to the event",
        tags: ["Players"],
        parameters: [eventIdParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Player added" },
          ...errorResponses,
        },
      },
      delete: {
        summary: "Remove a player from the event",
        tags: ["Players"],
        parameters: [eventIdParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
        },
        responses: { "200": { description: "Player removed" }, ...errorResponses },
      },
    },
    "/api/events/{id}/reorder-players": {
      put: {
        summary: "Reorder players (owner only)",
        tags: ["Players"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Players reordered" }, ...errorResponses },
      },
    },
    "/api/events/{id}/claim-player": {
      post: {
        summary: "Claim an anonymous player as your account",
        tags: ["Players"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Player claimed" }, ...errorResponses },
      },
    },
    "/api/events/{id}/undo-remove": {
      post: {
        summary: "Undo a recent player removal",
        tags: ["Players"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Removal undone" }, ...errorResponses },
      },
    },
    "/api/events/{id}/known-players": {
      get: {
        summary: "Get known player names for autocomplete",
        tags: ["Players"],
        parameters: [eventIdParam],
        responses: { "200": { description: "List of known player names" } },
      },
    },

    // ── Teams ───────────────────────────────────────────────────────────
    "/api/events/{id}/teams": {
      get: {
        summary: "Get current team assignments",
        tags: ["Teams"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Team assignments" } },
      },
    },
    "/api/events/{id}/randomize": {
      post: {
        summary: "Randomize team assignments",
        tags: ["Teams"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Teams randomized" }, ...errorResponses },
      },
    },

    // ── History ─────────────────────────────────────────────────────────
    "/api/events/{id}/history": {
      get: {
        summary: "Get game history for an event",
        tags: ["History"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Game history entries" } },
      },
    },
    "/api/events/{id}/history/{historyId}": {
      patch: {
        summary: "Update a history entry (score, status)",
        tags: ["History"],
        parameters: [eventIdParam, { name: "historyId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "History entry updated" }, ...errorResponses },
      },
    },

    // ── Ratings ─────────────────────────────────────────────────────────
    "/api/events/{id}/ratings": {
      get: {
        summary: "Get player ELO ratings for an event",
        tags: ["Ratings"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Player ratings" } },
      },
    },
    "/api/events/{id}/ratings/recalculate": {
      post: {
        summary: "Recalculate all ELO ratings from history",
        tags: ["Ratings"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Ratings recalculated" }, ...errorResponses },
      },
    },

    // ── Calendar ────────────────────────────────────────────────────────
    "/api/events/{id}/calendar": {
      get: {
        summary: "Download .ics calendar file for an event",
        tags: ["Calendar"],
        parameters: [eventIdParam],
        responses: { "200": { description: "iCalendar file", content: { "text/calendar": {} } } },
      },
    },
    "/api/events/{id}/calendar.ics": {
      get: {
        summary: "iCal feed for an event (token-authenticated)",
        tags: ["Calendar"],
        parameters: [eventIdParam, { name: "token", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "iCalendar feed" }, "401": { description: "Missing token" }, "403": { description: "Invalid token" } },
      },
    },
    "/api/users/{id}/calendar.ics": {
      get: {
        summary: "iCal feed for a user's games (token-authenticated)",
        tags: ["Calendar"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "User ID" },
          { name: "token", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "iCalendar feed" }, "401": { description: "Missing token" }, "403": { description: "Invalid token" } },
      },
    },

    // ── Push Notifications ──────────────────────────────────────────────
    "/api/events/{id}/push": {
      post: {
        summary: "Subscribe to push notifications for an event",
        tags: ["Push"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Subscribed" }, ...errorResponses },
      },
      delete: {
        summary: "Unsubscribe from push notifications",
        tags: ["Push"],
        parameters: [eventIdParam],
        responses: { "200": { description: "Unsubscribed" } },
      },
    },
    "/api/push/vapid-public-key": {
      get: {
        summary: "Get VAPID public key for push subscriptions",
        tags: ["Push"],
        responses: { "200": { description: "VAPID public key" } },
      },
    },

    // ── Webhooks ────────────────────────────────────────────────────────
    "/api/events/{id}/webhooks": {
      get: {
        summary: "List webhooks for an event",
        tags: ["Webhooks"],
        parameters: [eventIdParam],
        responses: { "200": { description: "List of webhooks" } },
      },
      post: {
        summary: "Register a webhook for an event",
        tags: ["Webhooks"],
        parameters: [eventIdParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri" },
                  secret: { type: "string" },
                  events: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Webhook created" }, ...errorResponses },
      },
    },
    "/api/events/{id}/webhooks/{webhookId}": {
      delete: {
        summary: "Delete a webhook",
        tags: ["Webhooks"],
        parameters: [eventIdParam, { name: "webhookId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Webhook deleted" }, ...errorResponses },
      },
    },

    // ── Users ───────────────────────────────────────────────────────────
    "/api/users/{id}": {
      get: {
        summary: "Get user profile",
        tags: ["Users"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "User ID" }],
        responses: { "200": { description: "User profile with game history" }, "404": { description: "User not found" } },
      },
      patch: {
        summary: "Update own profile",
        tags: ["Users"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
        responses: { "200": { description: "Profile updated" }, ...errorResponses },
      },
    },

    // ── Me ──────────────────────────────────────────────────────────────
    "/api/me/games": {
      get: {
        summary: "Get authenticated user's games",
        tags: ["Users"],
        responses: { "200": { description: "Owned and joined games" }, "401": { description: "Unauthorized" } },
      },
    },
    "/api/me/calendar-token": {
      post: {
        summary: "Generate or retrieve a calendar feed token",
        tags: ["Calendar"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  scope: { type: "string", enum: ["user", "event"] },
                  eventId: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Token and feed URL" }, "401": { description: "Unauthorized" } },
      },
      delete: {
        summary: "Revoke all calendar tokens",
        tags: ["Calendar"],
        responses: { "200": { description: "Tokens revoked" }, "401": { description: "Unauthorized" } },
      },
    },

    // ── OAuth 2.1 ─────────────────────────────────────────────────────────
    "/.well-known/openid-configuration": {
      get: {
        summary: "OpenID Connect discovery document",
        tags: ["OAuth"],
        responses: { "200": { description: "OIDC metadata" } },
      },
    },
    "/api/auth/oauth2/authorize": {
      get: {
        summary: "Authorization endpoint (OAuth 2.1 authorization code flow)",
        tags: ["OAuth"],
        parameters: [
          { name: "client_id", in: "query", required: true, schema: { type: "string" } },
          { name: "redirect_uri", in: "query", required: true, schema: { type: "string" } },
          { name: "response_type", in: "query", required: true, schema: { type: "string", enum: ["code"] } },
          { name: "scope", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", required: true, schema: { type: "string" } },
          { name: "code_challenge", in: "query", required: true, schema: { type: "string" }, description: "PKCE code challenge (S256)" },
          { name: "code_challenge_method", in: "query", required: true, schema: { type: "string", enum: ["S256"] } },
        ],
        responses: {
          "302": { description: "Redirect to login or consent page" },
          "400": { description: "Invalid request parameters" },
        },
      },
    },
    "/api/auth/oauth2/token": {
      post: {
        summary: "Token endpoint — exchange code for tokens or refresh",
        tags: ["OAuth"],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["grant_type"],
                properties: {
                  grant_type: { type: "string", enum: ["authorization_code", "refresh_token"] },
                  code: { type: "string", description: "Authorization code (for authorization_code grant)" },
                  redirect_uri: { type: "string" },
                  client_id: { type: "string" },
                  client_secret: { type: "string" },
                  code_verifier: { type: "string", description: "PKCE code verifier" },
                  refresh_token: { type: "string", description: "Refresh token (for refresh_token grant)" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Access token, refresh token, and optional ID token" },
          "400": { description: "Invalid grant or request" },
          "401": { description: "Invalid client credentials" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/auth/oauth2/register": {
      post: {
        summary: "Dynamic client registration (RFC 7591)",
        tags: ["OAuth"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["redirect_uris"],
                properties: {
                  redirect_uris: { type: "array", items: { type: "string", format: "uri" } },
                  client_name: { type: "string" },
                  client_uri: { type: "string", format: "uri" },
                  logo_uri: { type: "string", format: "uri" },
                  scope: { type: "string" },
                  token_endpoint_auth_method: { type: "string", enum: ["none", "client_secret_basic", "client_secret_post"] },
                  grant_types: { type: "array", items: { type: "string" } },
                  response_types: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Registered client with client_id and optional client_secret" },
          "400": { description: "Invalid registration request" },
          "429": { description: "Rate limited (5 registrations per hour)" },
        },
      },
    },
    "/api/auth/oauth2/userinfo": {
      get: {
        summary: "UserInfo endpoint — returns claims about the authenticated user",
        tags: ["OAuth"],
        security: [{ oauth2: ["openid"] }],
        responses: {
          "200": { description: "User claims (sub, email, name, picture)" },
          "401": { description: "Invalid or missing bearer token" },
        },
      },
    },
    "/api/auth/oauth2/introspect": {
      post: {
        summary: "Token introspection (RFC 7662)",
        tags: ["OAuth"],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["token"],
                properties: {
                  token: { type: "string", description: "The token to introspect" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Token metadata with active status" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/auth/oauth2/revoke": {
      post: {
        summary: "Token revocation (RFC 7009)",
        tags: ["OAuth"],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["token"],
                properties: {
                  token: { type: "string", description: "The token to revoke" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Token revoked (always returns 200 per RFC 7009)" },
          "429": { description: "Rate limited" },
        },
      },
    },
  },
  tags: [
    { name: "System", description: "Health and status" },
    { name: "Events", description: "Create and manage game events" },
    { name: "Players", description: "Add, remove, and manage players" },
    { name: "Teams", description: "Team assignments and randomization" },
    { name: "History", description: "Game history and scores" },
    { name: "Ratings", description: "ELO player ratings" },
    { name: "Calendar", description: "iCal feeds and calendar integration" },
    { name: "Push", description: "Push notification subscriptions" },
    { name: "Webhooks", description: "Webhook subscriptions and delivery" },
    { name: "Users", description: "User profiles and authentication" },
    { name: "OAuth", description: "OAuth 2.1 authorization server endpoints" },
  ],
  components: {
    securitySchemes: {
      oauth2: {
        type: "oauth2",
        description: "OAuth 2.1 authorization code flow with PKCE",
        flows: {
          authorizationCode: {
            authorizationUrl: "/api/auth/oauth2/authorize",
            tokenUrl: "/api/auth/oauth2/token",
            scopes: {
              openid: "Verify your identity",
              profile: "View your basic profile",
              email: "View your email address",
              offline_access: "Stay signed in (refresh tokens)",
              "read:profile": "View your profile",
              "read:events": "View your events",
              "write:events": "Modify event settings",
              "create:events": "Create new events",
              "manage:players": "Add and remove players",
              "read:ratings": "View ELO ratings",
              "read:history": "View game history",
              "manage:teams": "Randomize and assign teams",
              "manage:webhooks": "Manage webhooks",
              "manage:push": "Manage push subscriptions",
              "read:calendar": "Access calendar feeds",
              "manage:payments": "Manage costs and payments",
            },
          },
        },
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "API key authentication. Use `Bearer cvk_...` format.",
      },
    },
  },
  security: [{ oauth2: [] }, { apiKey: [] }],
};
