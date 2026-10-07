/**
 * Invariants for the whole MCP tool table.
 *
 * Cross-cutting properties no single tool test would catch. These matter
 * because a tool table is effectively a prompt: a model chooses from it. Bad
 * names, thin descriptions or malformed schemas degrade every tool call, so the
 * shape is enforced centrally rather than per-tool.
 */
import { describe, it, expect } from "vitest";
import { TOOLS, type ToolDef } from "~/lib/mcp/tools";
import { APP_SCOPES } from "~/lib/scopes";
import { RSVP_STATUS_VALUES } from "~/lib/rsvp";

const READ_TOOLS = new Set([
  "convocados_get_balance",
  "convocados_get_game",
  "convocados_get_history",
  "convocados_get_ratings",
  "convocados_list_my_games",
  "convocados_list_players",
  "convocados_list_public_events",
  "convocados_whoami",
]);

const ANONYMOUS_TOOLS = new Set([
  "convocados_get_game",
  "convocados_list_public_events",
]);

/** Self-service tools act as the caller, so no organiser scope may gate them. */
const SELF_SERVICE_TOOLS = [
  "convocados_rsvp",
  "convocados_follow_event",
  "convocados_unfollow_event",
  "convocados_leave_event",
];

function tool(name: string): ToolDef {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

describe("tool table — naming", () => {
  it("has no duplicate names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("namespaces every tool with the-application prefix", () => {
    for (const t of TOOLS) expect(t.name, t.name).toMatch(/^convocados_[a-z0-9_]+$/);
  });

  it("keeps the table small enough for reliable tool selection", () => {
    // ponytail: model tool-selection accuracy degrades past roughly 30 options.
    // Raise only alongside a measured improvement in selection rate.
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    expect(TOOLS.length).toBeGreaterThan(5);
  });

  it("lists tools in a stable sorted order", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("tool table — descriptions", () => {
  it("gives every tool a description a model can act on", () => {
    for (const t of TOOLS) {
      expect(t.description.trim().length, `${t.name} description length`).toBeGreaterThan(40);
      expect(t.description.trimEnd(), `${t.name} ends with a period`).toMatch(/\.$/);
    }
  });

  it("documents the authorization rule on every mutating tool", () => {
    // An agent that guesses wrong here writes data it cannot undo.
    for (const t of TOOLS) {
      if (READ_TOOLS.has(t.name)) continue;
      expect(t.description, `${t.name} states who may call it`).toMatch(
        /self-service|owner|admin|organi[sz]er|caller|your own/i,
      );
    }
  });

  it("describes every argument", () => {
    for (const t of TOOLS) {
      const schema = t.inputSchema as { properties?: Record<string, { description?: string }> };
      for (const [key, prop] of Object.entries(schema.properties ?? {})) {
        expect(prop?.description, `${t.name}.${key} has a description`).toBeTruthy();
      }
    }
  });
});

describe("tool table — schemas", () => {
  it("gives every tool an object schema", () => {
    for (const t of TOOLS) {
      expect((t.inputSchema as { type?: string }).type, `${t.name} schema type`).toBe("object");
    }
  });

  it("only requires properties that are actually declared", () => {
    for (const t of TOOLS) {
      const schema = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      for (const key of schema.required ?? []) {
        expect(schema.properties, `${t.name} requires declared "${key}"`).toHaveProperty(key);
      }
    }
  });

  it("declares eventId wherever the description mentions it", () => {
    for (const t of TOOLS) {
      if (!/eventid/i.test(t.description)) continue;
      expect(
        (t.inputSchema as { properties?: Record<string, unknown> }).properties,
        `${t.name} declares eventId`,
      ).toHaveProperty("eventId");
    }
  });

  it("enumerates rsvp status with the canonical values", () => {
    const status = (tool("convocados_rsvp").inputSchema as any).properties.status;
    expect(status.enum).toEqual([...RSVP_STATUS_VALUES]);
  });

  it("enumerates payment status with the canonical values", () => {
    const status = (tool("convocados_update_payment").inputSchema as any).properties.status;
    expect(status.enum).toEqual(["pending", "sent", "paid"]);
  });

  it("requires eventPlayerId wherever a player is identified by id", () => {
    // A player id with no way to supply one is a dead argument.
    for (const t of TOOLS) {
      const schema = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      if (!("eventPlayerId" in (schema.properties ?? {}))) continue;
      expect(schema.required, `${t.name} requires eventPlayerId`).toContain("eventPlayerId");
    }
  });
});

describe("tool table — authorization metadata", () => {
  it("declares only scopes that exist", () => {
    for (const t of TOOLS) expect(APP_SCOPES, `${t.name} scope ${t.scope}`).toContain(t.scope);
  });

  it("gates no self-service tool behind an organiser scope", () => {
    // rsvp/follow/leave act as the caller. Requiring manage:* means a token
    // granted only read access cannot answer its own RSVP or leave.
    for (const name of SELF_SERVICE_TOOLS) {
      expect(tool(name).scope, name).not.toMatch(/^manage:/);
    }
  });

  it("keeps organiser mutations on a write-ish scope", () => {
    const organiser = [
      "convocados_add_player",
      "convocados_remove_player",
      "convocados_randomize_teams",
      "convocados_update_payment",
      "convocados_set_no_show",
      "convocados_set_score",
      "convocados_create_event",
      "convocados_update_event",
      "convocados_cancel_event",
    ];
    for (const name of organiser) {
      expect(tool(name).scope, name).toMatch(/^(manage|write|create):/);
      expect(tool(name).scope, name).not.toBe("read:events");
    }
  });

  it("gives every read tool a read scope", () => {
    for (const name of READ_TOOLS) {
      expect(tool(name).scope, name).toMatch(/^read:/);
    }
  });

  it("marks only the intended tools as anonymous-capable", () => {
    const anon = TOOLS.filter((t) => t.requiresAuth === false).map((t) => t.name);
    expect(new Set(anon)).toEqual(ANONYMOUS_TOOLS);
  });
});
