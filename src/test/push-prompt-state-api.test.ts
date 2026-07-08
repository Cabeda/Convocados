import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
vi.mock("~/lib/rsvp.server", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, setPushPromptState: vi.fn() };
});

import { getSession } from "~/lib/auth.helpers.server";
import { setPushPromptState } from "~/lib/rsvp.server";
import { PUT } from "~/pages/api/users/me/push-prompt-state";

function ctx(body: unknown) {
  const request = new Request("http://localhost/api/users/me/push-prompt-state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1", email: "a@b.com" } } as any);
  vi.mocked(setPushPromptState).mockResolvedValue(undefined as any);
});

describe("PUT /api/users/me/push-prompt-state", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);
    const res = await PUT(ctx({ state: "granted" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid state", async () => {
    const res = await PUT(ctx({ state: "invalid" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("state must be one of");
  });

  it("returns 400 for missing state", async () => {
    const res = await PUT(ctx({}));
    expect(res.status).toBe(400);
  });

  it("accepts 'granted' and calls setPushPromptState", async () => {
    const res = await PUT(ctx({ state: "granted" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.state).toBe("granted");
    expect(setPushPromptState).toHaveBeenCalledWith("u1", "granted");
  });

  it("accepts 'dismissed'", async () => {
    const res = await PUT(ctx({ state: "dismissed" }));
    expect(res.status).toBe(200);
  });

  it("accepts 'denied'", async () => {
    const res = await PUT(ctx({ state: "denied" }));
    expect(res.status).toBe(200);
  });

  it("accepts 'default'", async () => {
    const res = await PUT(ctx({ state: "default" }));
    expect(res.status).toBe(200);
  });
});
