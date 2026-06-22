import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { enqueuePushSetupHint, PUSH_SETUP_HINT_COOLDOWN_MS } from "~/lib/pushSetupHint";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    inAppNotification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const mockFindFirst = vi.mocked(prisma.inAppNotification.findFirst);
const mockCreate = vi.mocked(prisma.inAppNotification.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enqueuePushSetupHint", () => {
  it("creates a push_setup_hint in-app notification when none exists recently", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({} as any);

    await enqueuePushSetupHint("user-1", "event-1");

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        type: "push_setup_hint",
        createdAt: { gte: expect.any(Date) },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        eventId: "event-1",
        type: "push_setup_hint",
        url: "/settings?focus=notifications",
      }),
    });
    // Title and body should be non-empty localized strings.
    const call = mockCreate.mock.calls[0]?.[0] as { data: { title: string; body: string } };
    expect(call.data.title).toBeTruthy();
    expect(call.data.body).toBeTruthy();
  });

  it("is a no-op when a recent hint already exists (cooldown)", async () => {
    mockFindFirst.mockResolvedValue({
      id: "n1", userId: "user-1", eventId: null, type: "push_setup_hint",
      title: "t", body: "b", url: null, readAt: null, createdAt: new Date(),
    });

    await enqueuePushSetupHint("user-1", "event-1");

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("links the notification to the originating event for context", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({} as any);

    await enqueuePushSetupHint("user-1", "event-42");

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: "event-42" }),
    });
  });

  it("cooldown window is 7 days", () => {
    expect(PUSH_SETUP_HINT_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("passes a 'now' Date to the recent-hint check so the SQL filter is correct", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({} as any);

    const before = Date.now();
    await enqueuePushSetupHint("user-1", "event-1");
    const call = mockFindFirst.mock.calls[0]?.[0] as
      { where: { createdAt: { gte: Date } } };
    const ts = call.where.createdAt.gte.getTime();
    const after = Date.now();

    expect(ts).toBeGreaterThanOrEqual(before - PUSH_SETUP_HINT_COOLDOWN_MS);
    expect(ts).toBeLessThanOrEqual(after - PUSH_SETUP_HINT_COOLDOWN_MS + 50);
  });
});
