import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import {
  backfillGoogleProfileImageFromLogin,
  pictureFromIdToken,
  resolveGooglePicture,
  syncGoogleProfileImage,
} from "~/lib/syncGoogleImage.server";

const mockGetSession = vi.fn<() => Promise<{ user: { id: string; image?: string | null } } | null>>();
vi.mock("~/lib/auth.server", () => ({
  auth: { api: { getSession: () => mockGetSession() } },
  ensureTrustedClientInDB: vi.fn().mockResolvedValue(undefined),
}));

function makeIdToken(payload: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", kid: "k" })}.${enc(payload)}.${enc({})}`;
}

async function seedUser(image: string | null, account: Record<string, unknown> | null) {
  const id = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.user.create({
    data: {
      id,
      name: "Sync Test",
      email: `${id}@test.com`,
      emailVerified: true,
      image,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  if (account) {
    await prisma.account.create({
      data: {
        id: `${id}-acct`,
        userId: id,
        providerId: "google",
        accountId: `g-${id}`,
        ...account,
      },
    });
  }
  return id;
}

function loginResponse() {
  return new Response(null, {
    status: 200,
    headers: { "set-cookie": "better-auth.session_token=abc123; Path=/; HttpOnly" },
  });
}

describe("pictureFromIdToken", () => {
  it("extracts the picture from a Google id token payload", () => {
    const token = makeIdToken({ sub: "123", email: "a@b.com", picture: "https://example.com/me.jpg" });
    expect(pictureFromIdToken(token)).toBe("https://example.com/me.jpg");
  });

  it("returns null when the token has no picture", () => {
    expect(pictureFromIdToken(makeIdToken({ sub: "123" }))).toBeNull();
  });

  it("returns null for malformed tokens", () => {
    expect(pictureFromIdToken("not-a-jwt")).toBeNull();
    expect(pictureFromIdToken("a.b")).toBeNull();
    expect(pictureFromIdToken("")).toBeNull();
  });
});

describe("syncGoogleProfileImage", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetApiRateLimitStore();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  it("fills a missing image from the id-token picture passed at login", async () => {
    const userId = await seedUser(null, {});
    await syncGoogleProfileImage(userId, "https://example.com/login-pic.jpg");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/login-pic.jpg");
  });

  it("does not touch a user that already has an image", async () => {
    const userId = await seedUser("https://example.com/existing.jpg", {});
    await syncGoogleProfileImage(userId, "https://example.com/new-pic.jpg");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/existing.jpg");
  });

  it("does nothing when the user has no linked google account", async () => {
    const userId = await seedUser(null, null);
    await syncGoogleProfileImage(userId, "https://example.com/pic.jpg");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBeNull();
  });

  it("resolves the picture from the stored google id token", async () => {
    const idToken = makeIdToken({ picture: "https://example.com/from-idtoken.jpg" });
    const userId = await seedUser(null, { idToken });
    await syncGoogleProfileImage(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/from-idtoken.jpg");
  });

  it("resolves the picture from the access token via Google userinfo", async () => {
    const userId = await seedUser(null, { accessToken: "at-123" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ picture: "https://example.com/from-userinfo.jpg" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await syncGoogleProfileImage(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/from-userinfo.jpg");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("googleapis.com"),
      expect.objectContaining({ headers: { authorization: "Bearer at-123" } }),
    );
  });

  it("ignores a failed Google userinfo call", async () => {
    const userId = await seedUser(null, { accessToken: "bad-token" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await syncGoogleProfileImage(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBeNull();
  });

  it("ignores a throwing fetch call", async () => {
    const userId = await seedUser(null, { accessToken: "at-123" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await syncGoogleProfileImage(userId);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBeNull();
  });

  it("does nothing for a missing user", async () => {
    await expect(syncGoogleProfileImage("does-not-exist", "https://example.com/pic.jpg")).resolves.toBeUndefined();
  });
});

describe("resolveGooglePicture", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prefers the id token picture over the access token", async () => {
    const idToken = makeIdToken({ picture: "https://example.com/id.jpg" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ picture: "https://example.com/at.jpg" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveGooglePicture({ idToken, accessToken: "at" })).toBe("https://example.com/id.jpg");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when nothing can be resolved", async () => {
    expect(await resolveGooglePicture({})).toBeNull();
    expect(await resolveGooglePicture({ idToken: null, accessToken: null })).toBeNull();
  });
});

describe("backfillGoogleProfileImageFromLogin", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  it("fills the missing image from the id-token picture", async () => {
    const userId = await seedUser(null, {});
    mockGetSession.mockResolvedValueOnce({ user: { id: userId } });
    await backfillGoogleProfileImageFromLogin(loginResponse(), "https://example.com/filled.jpg");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/filled.jpg");
  });

  it("backs off when the login response carries no session cookie", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = new Response(null, { status: 200 });
    await backfillGoogleProfileImageFromLogin(res, "https://example.com/pic.jpg");
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("without a session cookie"));
    warnSpy.mockRestore();
  });

  it("does not write when the session user already has an image", async () => {
    const userId = await seedUser("https://example.com/kept.jpg", {});
    mockGetSession.mockResolvedValueOnce({ user: { id: userId, image: "https://example.com/kept.jpg" } });
    await backfillGoogleProfileImageFromLogin(loginResponse(), "https://example.com/new.jpg");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.image).toBe("https://example.com/kept.jpg");
  });

  it("never throws into the login flow", async () => {
    mockGetSession.mockRejectedValueOnce(new Error("session store down"));
    await expect(backfillGoogleProfileImageFromLogin(loginResponse(), null)).resolves.toBeUndefined();
  });
});