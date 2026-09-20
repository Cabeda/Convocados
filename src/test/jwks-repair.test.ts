import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { symmetricEncrypt } from "better-auth/crypto";
import { prisma } from "~/lib/db.server";
import { repairStaleJwks } from "~/lib/jwksRepair.server";

const OLD_SECRET = "old-secret-0123456789-0123456789-0123456789";
const NEW_SECRET = "new-secret-9876543210-9876543210-9876543210";

async function seedEncryptedKey(id: string, secret: string) {
  const privateKey = JSON.stringify(
    await symmetricEncrypt({ key: secret, data: JSON.stringify({ kty: "OKP", crv: "Ed25519", d: "x" }) }),
  );
  await prisma.jwks.create({
    data: { id, publicKey: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "y" }), privateKey, createdAt: new Date() },
  });
}

describe("repairStaleJwks", () => {
  beforeEach(async () => {
    await prisma.jwks.deleteMany();
  });

  afterAll(async () => {
    await prisma.jwks.deleteMany();
  });

  it("deletes a key that cannot be decrypted with the current secret", async () => {
    await seedEncryptedKey("stale", OLD_SECRET);

    const removed = await repairStaleJwks(NEW_SECRET);

    expect(removed).toBe(1);
    expect(await prisma.jwks.count()).toBe(0);
  });

  it("keeps a key that decrypts with the current secret", async () => {
    await seedEncryptedKey("live", NEW_SECRET);

    const removed = await repairStaleJwks(NEW_SECRET);

    expect(removed).toBe(0);
    expect(await prisma.jwks.count()).toBe(1);
  });

  it("removes only the stale keys and leaves the live one", async () => {
    await seedEncryptedKey("stale", OLD_SECRET);
    await seedEncryptedKey("live", NEW_SECRET);

    const removed = await repairStaleJwks(NEW_SECRET);

    expect(removed).toBe(1);
    const remaining = await prisma.jwks.findMany({ select: { id: true } });
    expect(remaining.map((r) => r.id)).toEqual(["live"]);
  });

  it("is a no-op when there are no keys", async () => {
    expect(await repairStaleJwks(NEW_SECRET)).toBe(0);
  });
});
