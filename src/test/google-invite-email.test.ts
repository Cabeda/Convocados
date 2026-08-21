import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { getInviteChannels } from "~/lib/invite.server";
import { getNotificationPrefs } from "~/lib/notificationPrefs.server";

vi.mock("~/lib/email.server", async (importOriginal) => {
  const mod = await importOriginal() as any;
  return { ...mod, isEmailConfigured: () => true };
});

describe("Google email auto-enable for invites", () => {
  beforeEach(async () => {
    await prisma.notificationPreferences.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  it("sends email for Google users with verified email even when prefs are off", async () => {
    const user = await prisma.user.create({
      data: {
        id: "u-google-1",
        name: "Google User",
        email: "google@example.com",
        emailVerified: true,
      },
    });
    await prisma.account.create({
      data: {
        id: "acc-google-1",
        userId: user.id,
        providerId: "google",
        accountId: "google-123",
      },
    });
    // Create prefs with email disabled (default)
    await prisma.notificationPreferences.create({
      data: {
        userId: user.id,
        emailEnabled: false,
        gameInviteEmail: false,
      },
    });

    const channels = await getInviteChannels(user.id);
    // Should be true for Google users even though prefs are off
    expect(channels.email).toBe(true);
  });

  it("does not send email for non-Google users when prefs are off", async () => {
    const user = await prisma.user.create({
      data: {
        id: "u-regular-1",
        name: "Regular User",
        email: "regular@example.com",
        emailVerified: true,
      },
    });
    await prisma.notificationPreferences.create({
      data: {
        userId: user.id,
        emailEnabled: false,
        gameInviteEmail: false,
      },
    });

    const channels = await getInviteChannels(user.id);
    expect(channels.email).toBe(false);
  });

  it("getNotificationPrefs returns email enabled for Google users", async () => {
    const user = await prisma.user.create({
      data: {
        id: "u-google-2",
        name: "Google User 2",
        email: "google2@example.com",
        emailVerified: true,
      },
    });
    await prisma.account.create({
      data: {
        id: "acc-google-2",
        userId: user.id,
        providerId: "google",
        accountId: "google-456",
      },
    });
    await prisma.notificationPreferences.create({
      data: {
        userId: user.id,
        emailEnabled: false,
        gameInviteEmail: false,
      },
    });

    const prefs = await getNotificationPrefs(user.id);
    expect(prefs.emailEnabled).toBe(true);
    expect(prefs.gameInviteEmail).toBe(true);
  });
});
