import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/cron/backfill-unified";

const SECRET = "test-cron-secret";

function cronCtx(url = "http://localhost/api/cron/backfill-unified", secret: string | null = SECRET) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return { request: new Request(url, { method: "POST", headers }), params: {} } as any;
}

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET;
  await prisma.mvpVote.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/cron/backfill-unified", () => {
  it("is fail-closed without the cron secret", async () => {
    const res = await POST(cronCtx("http://localhost/api/cron/backfill-unified", null));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    const res = await POST(cronCtx("http://localhost/api/cron/backfill-unified", "nope"));
    expect(res.status).toBe(401);
  });

  it("runs the backfill and returns the counters", async () => {
    const event = await prisma.event.create({
      data: {
        title: "Cron Backfill", location: "P",
        dateTime: new Date("2025-04-01T18:00:00.000Z"),
        maxPlayers: 10, teamOneName: "A", teamTwoName: "B",
      },
    });
    await prisma.gameHistory.create({
      data: {
        eventId: event.id, dateTime: new Date("2025-04-01T18:00:00.000Z"),
        status: "played", source: "historical", teamOneName: "A", teamTwoName: "B",
        teamsSnapshot: JSON.stringify([
          { team: "A", formation: "4-4-2", players: [{ name: "Rui", order: 0, slot: 1 }] },
        ]),
        paymentsSnapshot: JSON.stringify([{ playerName: "Rui", amount: 5, status: "paid" }]),
      },
    });

    const res = await POST(cronCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.gamesCreated).toBe(1);
    expect(body.paymentsCreated).toBe(1);
    expect(body.participantsUpserted).toBe(1);
    expect(await prisma.game.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("scopes to a single event when eventId is supplied", async () => {
    const eventA = await prisma.event.create({
      data: { title: "A", location: "P", dateTime: new Date(), maxPlayers: 10, teamOneName: "A", teamTwoName: "B" },
    });
    const eventB = await prisma.event.create({
      data: { title: "B", location: "P", dateTime: new Date(), maxPlayers: 10, teamOneName: "A", teamTwoName: "B" },
    });
    for (const eventId of [eventA.id, eventB.id]) {
      await prisma.gameHistory.create({
        data: { eventId, dateTime: new Date(), status: "played", source: "historical", teamOneName: "A", teamTwoName: "B" },
      });
    }

    const res = await POST(cronCtx(`http://localhost/api/cron/backfill-unified?eventId=${eventA.id}`));
    const body = await res.json();
    expect(body.eventId).toBe(eventA.id);
    expect(body.gamesCreated).toBe(1);
    expect(await prisma.game.count({ where: { eventId: eventA.id } })).toBe(1);
    expect(await prisma.game.count({ where: { eventId: eventB.id } })).toBe(0);
  });
});
