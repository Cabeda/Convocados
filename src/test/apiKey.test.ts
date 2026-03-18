import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { hashApiKey, generateApiKey, validateApiKey, API_SCOPES } from "~/lib/apiKey.server";

beforeEach(async () => {
  await prisma.$executeRawUnsafe("DELETE FROM ApiKey");
  await prisma.$executeRawUnsafe("DELETE FROM User WHERE id = 'test-user-1'");
  await prisma.user.create({
    data: {
      id: "test-user-1",
      name: "Test User",
      email: "apikey-test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
});

describe("API key utilities", () => {
  it("generates a key with correct prefix", () => {
    const { raw } = generateApiKey();
    expect(raw.startsWith("cvk_")).toBe(true);
    expect(raw.length).toBeGreaterThan(40);
  });

  it("hashes a key deterministically", () => {
    const hash1 = hashApiKey("cvk_test123");
    const hash2 = hashApiKey("cvk_test123");
    expect(hash1).toBe(hash2);
  });

  it("different keys produce different hashes", () => {
    const hash1 = hashApiKey("cvk_aaa");
    const hash2 = hashApiKey("cvk_bbb");
    expect(hash1).not.toBe(hash2);
  });

  it("validates a stored API key", async () => {
    const { raw, hashed } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: "Test Key",
        hashedKey: hashed,
        prefix: raw.slice(0, 8),
        userId: "test-user-1",
        scopes: JSON.stringify(["read:events"]),
      },
    });

    const result = await validateApiKey(raw);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("test-user-1");
    expect(result!.scopes).toContain("read:events");
  });

  it("returns null for invalid key", async () => {
    const result = await validateApiKey("cvk_nonexistent");
    expect(result).toBeNull();
  });

  it("updates lastUsedAt on validation", async () => {
    const { raw, hashed } = generateApiKey();
    await prisma.apiKey.create({
      data: {
        name: "Test Key",
        hashedKey: hashed,
        prefix: raw.slice(0, 8),
        userId: "test-user-1",
        scopes: JSON.stringify(["read:events"]),
      },
    });

    await validateApiKey(raw);
    const key = await prisma.apiKey.findFirst({ where: { hashedKey: hashed } });
    expect(key!.lastUsedAt).not.toBeNull();
  });
});

describe("API_SCOPES", () => {
  it("contains expected scopes", () => {
    expect(API_SCOPES).toContain("read:events");
    expect(API_SCOPES).toContain("write:events");
    expect(API_SCOPES).toContain("manage:players");
    expect(API_SCOPES).toContain("create:events");
  });
});
