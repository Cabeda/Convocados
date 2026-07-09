/**
 * One-off backfill (ADR 0019): build a complete WalletTransaction ledger
 * from the legacy PlayerPayment + GameHistory.paymentsSnapshot + teamsSnapshot
 * data. Safe to run multiple times — every write is keyed on an idempotencyKey.
 *
 * Steps:
 *   1. For every Player row, ensure an EventPlayer exists.
 *   2. For every ghost Player (no userId), create a real User and link it.
 *   3. For every PlayerPayment, write a payment_received/payment_self_reported
 *      row to the ledger.
 *   4. For every GameHistory.paymentsSnapshot entry, write a row to the ledger
 *      with gameHistoryId set (the Historical Settlement path).
 *   5. For every GameHistory.teamsSnapshot member, write a per_game_share
 *      debit with gameHistoryId set.
 *
 * Usage: npm run wallet:backfill
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SnapshotEntry {
  playerName: string;
  amount: number;
  status: string;
  method?: string | null;
}

interface TeamMember {
  name: string;
  order: number;
}

interface TeamSnapshot {
  team: string;
  players: TeamMember[];
}

function ghostUserId(eventPlayerId: string): string {
  return `ghost:${eventPlayerId}`;
}

function ghostEmail(eventPlayerId: string): string {
  return `ghost-${eventPlayerId}@system.local`;
}

async function ensureEventPlayerForPlayer(player: { id: string; eventId: string; name: string; userId: string | null }): Promise<{ eventPlayerId: string; userId: string | null }> {
  const existing = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId: player.eventId, name: player.name } },
  });

  if (existing && existing.userId) {
    return { eventPlayerId: existing.id, userId: existing.userId };
  }

  if (existing && !existing.userId && player.userId) {
    await prisma.eventPlayer.update({
      where: { id: existing.id },
      data: { userId: player.userId },
    });
    return { eventPlayerId: existing.id, userId: player.userId };
  }

  if (existing && !existing.userId && !player.userId) {
    const userId = ghostUserId(existing.id);
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, name: player.name, email: ghostEmail(existing.id), emailVerified: false },
      update: {},
    });
    await prisma.eventPlayer.update({
      where: { id: existing.id },
      data: { userId },
    });
    return { eventPlayerId: existing.id, userId };
  }

  // No existing EventPlayer.
  const created = await prisma.eventPlayer.create({
    data: { eventId: player.eventId, name: player.name },
  });

  if (player.userId) {
    await prisma.eventPlayer.update({
      where: { id: created.id },
      data: { userId: player.userId },
    });
    return { eventPlayerId: created.id, userId: player.userId };
  }

  // Ghost: use the stable eventPlayerId as the ghost user id.
  const userId = ghostUserId(created.id);
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, name: player.name, email: ghostEmail(created.id), emailVerified: false },
    update: {},
  });
  await prisma.eventPlayer.update({
    where: { id: created.id },
    data: { userId },
  });
  return { eventPlayerId: created.id, userId };
}

async function backfillPlayerPayment(pp: { id: string; eventCostId: string; playerName: string; amount: number; status: string; paidAt: Date | null; markedBy: string | null }): Promise<"created" | "skipped" | "no-player"> {
  const idempotencyKey = `backfill:playerPayment:${pp.id}`;
  const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return "skipped";

  const eventCost = await prisma.eventCost.findUnique({
    where: { id: pp.eventCostId },
    include: { event: { select: { id: true, eventCost: { select: { currency: true } } } } },
  });
  if (!eventCost) return "no-player";

  const event = await prisma.event.findUnique({
    where: { id: eventCost.eventId },
    select: { id: true },
  });
  if (!event) return "no-player";

  const player = await prisma.player.findFirst({
    where: { eventId: event.id, name: pp.playerName },
  });
  if (!player) return "no-player";

  const { userId } = await ensureEventPlayerForPlayer(player);
  if (!userId) return "no-player";

  if (pp.status === "paid") {
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id,
        userId,
        amountCents: Math.round(pp.amount * 100),
        currency: eventCost.currency,
        direction: "credit",
        reason: "payment_received",
        statusAfter: "paid",
        eventInstanceId: event.id,
        markedById: pp.markedBy ?? undefined,
        playerName: pp.playerName,
        idempotencyKey,
        createdAt: pp.paidAt ?? new Date(),
      },
    });
  } else if (pp.status === "sent") {
    await prisma.walletTransaction.create({
      data: {
        eventId: event.id,
        userId,
        amountCents: Math.round(pp.amount * 100),
        currency: eventCost.currency,
        direction: "credit",
        reason: "payment_self_reported",
        statusAfter: "sent",
        eventInstanceId: event.id,
        markedById: pp.markedBy ?? undefined,
        playerName: pp.playerName,
        idempotencyKey,
      },
    });
  }
  // 'pending' status: still owed; no ledger row. The per_game_share debit
  // (step 5) will represent the charge.
  return "created";
}

async function backfillSnapshotEntry(
  gameHistoryId: string,
  eventId: string,
  currency: string,
  entry: SnapshotEntry,
  gameEndTime: Date,
): Promise<"created" | "skipped" | "no-player"> {
  const idempotencyKey = `backfill:snapshot:${gameHistoryId}:${entry.playerName}`;
  const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return "skipped";

  const player = await prisma.player.findFirst({
    where: { eventId, name: entry.playerName },
  });
  if (!player) return "no-player";

  const { userId } = await ensureEventPlayerForPlayer(player);
  if (!userId) return "no-player";

  if (entry.status === "paid") {
    await prisma.walletTransaction.create({
      data: {
        eventId,
        userId,
        amountCents: Math.round(entry.amount * 100),
        currency,
        direction: "credit",
        reason: "payment_received",
        statusAfter: "paid",
        eventInstanceId: eventId,
        gameHistoryId,
        playerName: entry.playerName,
        idempotencyKey,
        createdAt: gameEndTime,
      },
    });
  } else if (entry.status === "sent") {
    await prisma.walletTransaction.create({
      data: {
        eventId,
        userId,
        amountCents: Math.round(entry.amount * 100),
        currency,
        direction: "credit",
        reason: "payment_self_reported",
        statusAfter: "sent",
        eventInstanceId: eventId,
        gameHistoryId,
        playerName: entry.playerName,
        idempotencyKey,
        createdAt: gameEndTime,
      },
    });
  }
  // 'pending' status: still owed.
  return "created";
}

async function backfillPerGameShare(
  gameHistoryId: string,
  eventId: string,
  currency: string,
  totalAmountCents: number,
  members: TeamMember[],
  gameStartTime: Date,
  gameDurationMinutes: number,
): Promise<{ created: number; skipped: number; noPlayer: number }> {
  const result = { created: 0, skipped: 0, noPlayer: 0 };
  if (members.length === 0) return result;

  const perShareCents = Math.round(totalAmountCents / members.length);
  const gameStartInstant = gameStartTime;

  for (const member of members) {
    const idempotencyKey = `backfill:perGameShare:${gameHistoryId}:${member.name}`;
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) { result.skipped++; continue; }

    const player = await prisma.player.findFirst({
      where: { eventId, name: member.name },
    });
    if (!player) { result.noPlayer++; continue; }

    const { userId } = await ensureEventPlayerForPlayer(player);
    if (!userId) { result.noPlayer++; continue; }

    await prisma.walletTransaction.create({
      data: {
        eventId,
        userId,
        amountCents: perShareCents,
        currency,
        direction: "debit",
        reason: "per_game_share",
        eventInstanceId: eventId,
        gameHistoryId,
        playerName: member.name,
        idempotencyKey,
        createdAt: gameStartInstant,
      },
    });
    result.created++;
  }
  return result;
}

async function main() {
  console.log("Step 1/5: ensure EventPlayer for every Player row...");
  const players = await prisma.player.findMany();
  console.log(`  Found ${players.length} Player rows.`);
  let playersCreated = 0;
  for (const p of players) {
    await ensureEventPlayerForPlayer(p);
    playersCreated++;
  }
  console.log(`  Done. Processed ${playersCreated} players.`);

  console.log("Step 2/5: backfill PlayerPayment → ledger (payment_received / payment_self_reported)...");
  const playerPayments = await prisma.playerPayment.findMany();
  console.log(`  Found ${playerPayments.length} PlayerPayment rows.`);
  let ppCreated = 0, ppSkipped = 0, ppNoPlayer = 0;
  for (const pp of playerPayments) {
    const r = await backfillPlayerPayment(pp);
    if (r === "created") ppCreated++;
    else if (r === "skipped") ppSkipped++;
    else ppNoPlayer++;
  }
  console.log(`  Done. created=${ppCreated}, skipped=${ppSkipped}, noPlayer=${ppNoPlayer}.`);

  console.log("Step 3/5: backfill GameHistory.paymentsSnapshot → ledger...");
  const histories = await prisma.gameHistory.findMany({
    where: { paymentsSnapshot: { not: null } },
    include: { event: { select: { id: true, eventCost: { select: { currency: true, totalAmount: true } } } } },
  });
  console.log(`  Found ${histories.length} GameHistory rows with paymentsSnapshot.`);
  let snapCreated = 0, snapSkipped = 0, snapNoPlayer = 0;
  for (const h of histories) {
    if (!h.paymentsSnapshot) continue;
    let entries: SnapshotEntry[];
    try {
      entries = JSON.parse(h.paymentsSnapshot);
    } catch {
      console.warn(`  Skip ${h.id}: malformed JSON.`);
      continue;
    }
    const currency = h.event.eventCost?.currency ?? "EUR";
    const gameEndTime = new Date(h.dateTime.getTime() + 60 * 60 * 1000); // game end ≈ start + 1h
    for (const entry of entries) {
      const r = await backfillSnapshotEntry(h.id, h.eventId, currency, entry, gameEndTime);
      if (r === "created") snapCreated++;
      else if (r === "skipped") snapSkipped++;
      else snapNoPlayer++;
    }
  }
  console.log(`  Done. created=${snapCreated}, skipped=${snapSkipped}, noPlayer=${snapNoPlayer}.`);

  console.log("Step 4/5: backfill GameHistory.teamsSnapshot → per_game_share debits...");
  const historiesWithTeams = await prisma.gameHistory.findMany({
    where: { teamsSnapshot: { not: null } },
    include: { event: { select: { id: true, durationMinutes: true, eventCost: { select: { currency: true, totalAmount: true } } } } },
  });
  console.log(`  Found ${historiesWithTeams.length} GameHistory rows with teamsSnapshot.`);
  let pgsCreated = 0, pgsSkipped = 0, pgsNoPlayer = 0;
  for (const h of historiesWithTeams) {
    if (!h.teamsSnapshot) continue;
    let teams: TeamSnapshot[];
    try {
      teams = JSON.parse(h.teamsSnapshot);
    } catch {
      continue;
    }
    const members: TeamMember[] = teams.flatMap((t) => t.players);
    if (members.length === 0) continue;
    const currency = h.event.eventCost?.currency ?? "EUR";
    const totalAmountCents = Math.round((h.event.eventCost?.totalAmount ?? 0) * 100);
    const r = await backfillPerGameShare(
      h.id,
      h.eventId,
      currency,
      totalAmountCents,
      members,
      h.dateTime,
      h.event.durationMinutes,
    );
    pgsCreated += r.created;
    pgsSkipped += r.skipped;
    pgsNoPlayer += r.noPlayer;
  }
  console.log(`  Done. created=${pgsCreated}, skipped=${pgsSkipped}, noPlayer=${pgsNoPlayer}.`);

  console.log("Step 5/5: summary...");
  const totals = await prisma.walletTransaction.groupBy({
    by: ["reason"],
    _count: { _all: true },
  });
  for (const t of totals) {
    console.log(`  ${t.reason}: ${t._count._all}`);
  }

  console.log("\nBackfill complete. Set WALLET_READ_PATH_ENABLED=true to switch the read path.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
