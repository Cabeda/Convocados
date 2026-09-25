/**
 * Unit tests for the shared Discoverable-Events where-clause.
 *
 * Discovery has one job that the pool keeps failing at: a public recurring game
 * must stay *findable* between occurrences. `Event.dateTime` is the current
 * occurrence and only advances on a lazy reset (a visit to the event page), so
 * for a recurring event whose occurrence just ended, `dateTime < now` even
 * though the next game is still coming. Filtering strictly on `dateTime >= now`
 * silently drops those recurring games out of Discover — the supply leak this
 * suite pins down.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  discoverableUpcomingWhere,
  findDiscoverableUpcomingEvents,
} from "~/lib/discoverableEvents.server";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

async function seedEvent(opts: {
  title: string;
  dateTime: Date;
  isPublic?: boolean;
  isRecurring?: boolean;
  recurrenceRule?: string | null;
  nextResetAt?: Date | null;
  archivedAt?: Date | null;
}) {
  return prisma.event.create({
    data: {
      title: opts.title,
      location: "Pitch",
      dateTime: opts.dateTime,
      isPublic: opts.isPublic ?? true,
      isRecurring: opts.isRecurring ?? false,
      recurrenceRule: opts.recurrenceRule ?? null,
      nextResetAt: opts.nextResetAt ?? null,
      archivedAt: opts.archivedAt ?? null,
    },
  });
}

describe("discoverableUpcomingWhere", () => {
  const rule = JSON.stringify({ freq: "weekly", interval: 1 });

  it("includes upcoming public non-archived events", async () => {
    const now = new Date();
    const ev = await seedEvent({ title: "Future", dateTime: new Date(now.getTime() + DAY) });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toContain(ev.id);
  });

  it("includes a recurring event whose current occurrence is still running", async () => {
    const now = new Date();
    // Kickoff was an hour ago but the game hasn't ended (nextResetAt still
    // ahead). `dateTime >= now` alone would hide it while it's being played.
    const ev = await seedEvent({
      title: "Weekly Recurring",
      dateTime: new Date(now.getTime() - HOUR),
      isRecurring: true,
      recurrenceRule: rule,
      nextResetAt: new Date(now.getTime() + HOUR),
    });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toContain(ev.id);
  });

  it("excludes a recurring event whose occurrence fully ended before the lazy reset", async () => {
    const now = new Date();
    // The game ended an hour ago and nobody has visited to roll the occurrence
    // forward. It is not joinable right now: the next date only exists once the
    // lazy reset runs, and rolling recurrence from a discovery read would
    // mutate state and risk double-firing reminders. It returns on the next visit.
    const ev = await seedEvent({
      title: "Recurring Finished",
      dateTime: new Date(now.getTime() - 2 * HOUR),
      isRecurring: true,
      recurrenceRule: rule,
      nextResetAt: new Date(now.getTime() - HOUR),
    });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(ev.id);
  });

  it("excludes a one-off event whose dateTime has passed", async () => {
    const now = new Date();
    const ev = await seedEvent({ title: "Past One-off", dateTime: new Date(now.getTime() - HOUR) });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(ev.id);
  });

  it("excludes archived and private events", async () => {
    const now = new Date();
    const archived = await seedEvent({
      title: "Archived",
      dateTime: new Date(now.getTime() + DAY),
      archivedAt: now,
    });
    const priv = await seedEvent({
      title: "Private",
      dateTime: new Date(now.getTime() + DAY),
      isPublic: false,
    });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now),
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(archived.id);
    expect(ids).not.toContain(priv.id);
  });

  it("excludes caller-provided ids", async () => {
    const now = new Date();
    const ev = await seedEvent({ title: "Excluded", dateTime: new Date(now.getTime() + DAY) });
    const rows = await prisma.event.findMany({
      where: discoverableUpcomingWhere(now, [ev.id]),
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(ev.id);
  });
});

describe("findDiscoverableUpcomingEvents", () => {
  const rule = JSON.stringify({ freq: "weekly", interval: 1 });

  it("surfaces an in-progress recurring game to the discover strip", async () => {
    const now = new Date();
    const ev = await seedEvent({
      title: "Weekly Recurring",
      dateTime: new Date(now.getTime() - HOUR),
      isRecurring: true,
      recurrenceRule: rule,
      nextResetAt: new Date(now.getTime() + HOUR),
    });
    const results = await findDiscoverableUpcomingEvents({ now, take: 3 });
    expect(results.map((e) => e.id)).toContain(ev.id);
  });

  it("drops a recurring game whose occurrence has fully ended before the lazy reset", async () => {
    const now = new Date();
    const ev = await seedEvent({
      title: "Weekly Recurring Ended",
      dateTime: new Date(now.getTime() - 2 * HOUR),
      isRecurring: true,
      recurrenceRule: rule,
      nextResetAt: new Date(now.getTime() - HOUR),
    });
    const results = await findDiscoverableUpcomingEvents({ now, take: 3 });
    expect(results.map((e) => e.id)).not.toContain(ev.id);
  });

  it("drops a recurring game with no usable rule even while nextResetAt is ahead", async () => {
    const now = new Date();
    const ev = await seedEvent({
      title: "Recurring No Rule",
      dateTime: new Date(now.getTime() - HOUR),
      isRecurring: true,
      recurrenceRule: null,
      nextResetAt: new Date(now.getTime() + HOUR),
    });
    const results = await findDiscoverableUpcomingEvents({ now, take: 10 });
    expect(results.map((e) => e.id)).not.toContain(ev.id);
  });
});
