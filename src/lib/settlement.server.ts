/**
 * Payment settlement — the new per-game payment model (wayfinder "Payment history,
 * payer designation & payments page").
 *
 * GamePayment rows mirror GameParticipant: one per (game, eventPlayer). A game is
 * either "tracked" (one payer designated; everyone else's share is owed to the
 * payer; a player-payer's own pill auto-settles) or "untracked" (each player pays
 * their own share; no rows, no tracking).
 *
 * Share = effective game cost (Game.costTotalAmount ?? EventCost.totalAmount) ÷
 * active participants (capped by maxPlayers; payer + no-shows count).
 *
 * Settle actions dual-write to the WalletTransaction ledger (recordReceived) so
 * the join-gate / outstanding-balance stays consistent.
 */
import { prisma, Prisma } from "./db.server";
import { recordReceived } from "./payments.server";

export type PaymentMode = "tracked" | "untracked";

export interface EffectiveCost {
  total: number;
  currency: string;
  mode: PaymentMode;
}

/** Effective cost + mode for a game. mode defaults to tracked (null column). */
export async function effectiveGameCost(gameId: string, eventId: string): Promise<EffectiveCost> {
  const [game, eventCost] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId }, select: { costTotalAmount: true, costCurrency: true, paymentMode: true } }),
    prisma.eventCost.findUnique({ where: { eventId }, select: { totalAmount: true, currency: true } }),
  ]);
  return {
    total: game?.costTotalAmount ?? eventCost?.totalAmount ?? 0,
    currency: game?.costCurrency ?? eventCost?.currency ?? "EUR",
    mode: (game?.paymentMode as PaymentMode | null) ?? "tracked",
  };
}

/** Active (non-archived) participants of a game, oldest-first. */
export async function activeParticipants(gameId: string) {
  return prisma.gameParticipant.findMany({
    where: { gameId, archivedAt: null },
    include: { eventPlayer: { select: { id: true, name: true, userId: true } } },
    orderBy: { order: "asc" },
  });
}

/** Per-participant share in euros (2dp). 0 when no cost or no participants. */
export function shareFor(total: number, participantsCount: number): number {
  return participantsCount > 0 ? Math.round((total / participantsCount) * 100) / 100 : 0;
}

/**
 * Reconcile GamePayment rows for a game against its active participants.
 * - Creates/revives a pending row for each participant at the current share.
 * - Archives rows for participants no longer active (soft, keeps history).
 * - Untracked games get no rows.
 * - Re-applies payer auto-settlement when the payer is an active participant.
 */
export async function syncGamePayments(gameId: string, eventId: string): Promise<void> {
  const { total, mode } = await effectiveGameCost(gameId, eventId);
  const participants = await activeParticipants(gameId);
  const share = shareFor(total, participants.length);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { payerEventPlayerId: true },
  });

  if (mode === "untracked" || total <= 0) {
    await prisma.gamePayment.deleteMany({ where: { gameId } });
    return;
  }

  const activeIds = participants.map((p) => p.eventPlayer.id);
  await prisma.gamePayment.updateMany({
    where: { gameId, eventPlayerId: { notIn: activeIds } },
    data: { archivedAt: new Date() },
  });

  for (const p of participants) {
    await prisma.gamePayment.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: p.eventPlayer.id } },
      create: {
        gameId,
        eventPlayerId: p.eventPlayer.id,
        playerName: p.eventPlayer.name,
        amount: share,
        status: "pending",
      },
      update: { amount: share, archivedAt: null, playerName: p.eventPlayer.name },
    });
  }

  // Revert rows that were auto-settled as payer but are no longer the payer
  // (payer changed to someone else, or to an external person / unassigned).
  await prisma.gamePayment.updateMany({
    where: {
      gameId,
      method: "payer",
      ...(game?.payerEventPlayerId ? { eventPlayerId: { not: game.payerEventPlayerId } } : {}),
    },
    data: { status: "pending", paidAt: null, method: null },
  });

  if (game?.payerEventPlayerId) {
    await prisma.gamePayment.updateMany({
      where: { gameId, eventPlayerId: game.payerEventPlayerId },
      data: { status: "paid", paidAt: new Date(), method: "payer" },
    });
  }
}

export interface PaymentConfig {
  mode: PaymentMode;
  payerEventPlayerId?: string;
  payerExternalName?: string;
}

/** Set a game's payment mode + payer. Tracked requires exactly one payer ref. */
export async function setPaymentConfig(
  eventId: string,
  gameId: string,
  config: PaymentConfig,
): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, eventId: true },
  });
  if (!game) throw new Error("Game not found.");
  if (game.eventId !== eventId) throw new Error("Game does not belong to this event.");

  if (config.mode === "untracked") {
    await prisma.$transaction([
      prisma.game.update({
        where: { id: gameId },
        data: { paymentMode: "untracked", payerEventPlayerId: null, payerExternalName: null },
      }),
      prisma.gamePayment.deleteMany({ where: { gameId } }),
    ]);
    return;
  }

  const hasPlayerPayer = !!config.payerEventPlayerId;
  const hasExternal = !!config.payerExternalName?.trim();
  if (hasPlayerPayer === hasExternal) {
    throw new Error("Tracked games require exactly one payer (a player or an external name).");
  }
  if (hasPlayerPayer) {
    const payer = await prisma.eventPlayer.findUnique({ where: { id: config.payerEventPlayerId! } });
    if (!payer || payer.eventId !== eventId) throw new Error("Payer is not a participant of this event.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: gameId },
      data: {
        paymentMode: "tracked",
        payerEventPlayerId: config.payerEventPlayerId ?? null,
        payerExternalName: config.payerExternalName?.trim() || null,
      },
    });
    await syncGamePaymentsTx(tx, gameId, eventId);
  });
}

/** tx-aware variant of syncGamePayments for transactional callers. */
export async function syncGamePaymentsTx(tx: Prisma.TransactionClient, gameId: string, eventId: string): Promise<void> {
  const { total, mode } = await effectiveGameCost(gameId, eventId);
  const participants = await tx.gameParticipant.findMany({
    where: { gameId, archivedAt: null },
    include: { eventPlayer: { select: { id: true, name: true } } },
    orderBy: { order: "asc" },
  });
  const game = await tx.game.findUnique({ where: { id: gameId }, select: { payerEventPlayerId: true } });
  const share = shareFor(total, participants.length);

  if (mode === "untracked" || total <= 0) {
    await tx.gamePayment.deleteMany({ where: { gameId } });
    return;
  }

  const activeIds = participants.map((p) => p.eventPlayer.id);
  await tx.gamePayment.updateMany({
    where: { gameId, eventPlayerId: { notIn: activeIds } },
    data: { archivedAt: new Date() },
  });

  for (const p of participants) {
    await tx.gamePayment.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: p.eventPlayer.id } },
      create: {
        gameId,
        eventPlayerId: p.eventPlayer.id,
        playerName: p.eventPlayer.name,
        amount: share,
        status: "pending",
      },
      update: { amount: share, archivedAt: null, playerName: p.eventPlayer.name },
    });
  }

  await tx.gamePayment.updateMany({
    where: {
      gameId,
      method: "payer",
      ...(game?.payerEventPlayerId ? { eventPlayerId: { not: game.payerEventPlayerId } } : {}),
    },
    data: { status: "pending", paidAt: null, method: null },
  });

  if (game?.payerEventPlayerId) {
    await tx.gamePayment.updateMany({
      where: { gameId, eventPlayerId: game.payerEventPlayerId },
      data: { status: "paid", paidAt: new Date(), method: "payer" },
    });
  }
}

// ─── Settle actions ─────────────────────────────────────────────────────────

/** Mark one share paid (owner/admin). Dual-writes the ledger credit. */
export async function settleShare(
  eventId: string,
  gameId: string,
  eventPlayerId: string,
  markedBy: string,
): Promise<void> {
  const payment = await prisma.gamePayment.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
  });
  if (!payment) throw new Error("Payment not found for this game and player.");
  if (payment.archivedAt) throw new Error("Payment is archived.");

  await prisma.$transaction(async (tx) => {
    await tx.gamePayment.update({
      where: { id: payment.id },
      data: { status: "paid", paidAt: new Date(), markedBy },
    });
    await recordReceived({
      eventId,
      playerName: payment.playerName,
      markedById: markedBy,
      amount: payment.amount,
      gameId,
    });
  });
}

/** Mark all debtor shares of a game paid (owner/admin). Dual-writes each ledger credit. */
export async function bulkSettleGame(eventId: string, gameId: string, markedBy: string): Promise<number> {
  const payments = await prisma.gamePayment.findMany({
    where: { gameId, archivedAt: null, status: { not: "paid" } },
  });

  await prisma.$transaction(async (tx) => {
    for (const p of payments) {
      await tx.gamePayment.update({
        where: { id: p.id },
        data: { status: "paid", paidAt: new Date(), markedBy },
      });
      await recordReceived({
        eventId,
        playerName: p.playerName,
        markedById: markedBy,
        amount: p.amount,
        gameId,
      });
    }
  });

  return payments.length;
}

/** Debtor self-report: pending → sent for their own share. */
export async function selfReportSent(gameId: string, eventPlayerId: string): Promise<void> {
  const payment = await prisma.gamePayment.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
  });
  if (!payment) throw new Error("Payment not found.");
  if (payment.status !== "pending") {
    throw new Error("Can only mark as sent when status is pending.");
  }
  await prisma.gamePayment.update({
    where: { id: payment.id },
    data: { status: "sent" },
  });
}

// ─── Settlement summary (payments page) ─────────────────────────────────────

export type ViewerRole = "owner" | "admin" | "player";

export interface SettlementGameView {
  gameId: string;
  dateTime: string;
  mode: PaymentMode;
  payerName: string | null;
  payerIsPlayer: boolean;
  total: number;
  paidCount: number;
  debtorCount: number;
  debtorNames: string[]; // owner/admin only; [] for players (privacy)
  rows: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }>;
}

export interface SettlementPersonView {
  name: string;
  isPlayer: boolean;
  isPayer: boolean;
  owedToAmount: number; // what others owe them (unpaid shares across games they paid)
  owedAmount: number; // their own unpaid shares
  lines: Array<{ gameId: string; dateTime: string; amount: number; status: string; role: "debtor" | "payer" }>;
}

export interface SettlementSummaryView {
  games: SettlementGameView[];
  people: SettlementPersonView[];
  currentGameId: string | null;
  viewerRole: ViewerRole;
  viewerEventPlayerId: string | null;
  totals: { unsettledGames: number; totalOwed: number; totalOwedTo: number };
}

/**
 * Per-event settlement summary for the payments page.
 * Receivers (payers) are always shown; debtor names are owner/admin-only;
 * a player sees only their own debt lines.
 */
export async function getSettlementSummary(
  eventId: string,
  viewer: { role: ViewerRole; userId?: string | null },
): Promise<SettlementSummaryView> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, currentGameId: true },
  });
  if (!event) throw new Error("Event not found.");

  const games = await prisma.game.findMany({
    where: { eventId, OR: [{ paymentMode: null }, { paymentMode: "tracked" }] },
    include: {
      payments: { where: { archivedAt: null }, include: { eventPlayer: { select: { name: true } } } },
      payerEventPlayer: { select: { id: true, name: true } },
    },
    orderBy: { dateTime: "asc" },
  });

  // Resolve the viewer's EventPlayer (for "own debt" trimming).
  let viewerEventPlayerId: string | null = null;
  let viewerEventPlayerName: string | null = null;
  if (viewer.userId) {
    const ep = await prisma.eventPlayer.findFirst({
      where: { eventId, userId: viewer.userId },
      select: { id: true, name: true },
    });
    if (ep) {
      viewerEventPlayerId = ep.id;
      viewerEventPlayerName = ep.name;
    }
  }

  const isManager = viewer.role === "owner" || viewer.role === "admin";
  const gameViews: SettlementGameView[] = [];
  const peopleMap = new Map<string, SettlementPersonView>();

  function personKey(name: string, isPlayer: boolean): string {
    return `${isPlayer ? "p:" : "e:"}${name.toLowerCase()}`;
  }
  function ensurePerson(name: string, isPlayer: boolean): SettlementPersonView {
    const key = personKey(name, isPlayer);
    let p = peopleMap.get(key);
    if (!p) {
      p = { name, isPlayer, isPayer: false, owedToAmount: 0, owedAmount: 0, lines: [] };
      peopleMap.set(key, p);
    }
    return p;
  }

  for (const game of games) {
    const activeRows = game.payments;
    if (activeRows.length === 0) continue; // no tracked payments → nothing to settle

    const payerName = game.payerEventPlayer?.name ?? game.payerExternalName;
    const payerIsPlayer = !!game.payerEventPlayer;
    const payerEventPlayerId = game.payerEventPlayer?.id ?? null;

    const debtors = activeRows.filter((r) => r.status === "pending" || r.status === "sent");
    const unsettled = debtors.length > 0;
    if (!unsettled) continue; // auto-settled — drops off the page

    const totalDebt = debtors.reduce((s, r) => s + r.amount, 0);
    const debtorNames = debtors.map((r) => r.eventPlayer.name);

    gameViews.push({
      gameId: game.id,
      dateTime: game.dateTime.toISOString(),
      mode: (game.paymentMode as PaymentMode | null) ?? "tracked",
      payerName,
      payerIsPlayer,
      total: totalDebt,
      paidCount: activeRows.filter((r) => r.status === "paid").length,
      debtorCount: debtors.length,
      debtorNames: isManager ? debtorNames : [],
      rows: activeRows.map((r) => ({
        eventPlayerId: r.eventPlayerId,
        name: r.eventPlayer.name,
        amount: r.amount,
        status: r.status,
        isPayer: payerEventPlayerId === r.eventPlayerId,
      })),
    });

    // Payer is owed the sum of unpaid shares.
    if (payerName) {
      const payer = ensurePerson(payerName, payerIsPlayer);
      payer.isPayer = true;
      payer.owedToAmount += totalDebt;
      payer.lines.push({ gameId: game.id, dateTime: game.dateTime.toISOString(), amount: totalDebt, status: "owed", role: "payer" });
    }

    // Debtors owe their shares.
    for (const r of debtors) {
      const debtor = ensurePerson(r.eventPlayer.name, true);
      debtor.owedAmount += r.amount;
      debtor.lines.push({ gameId: game.id, dateTime: game.dateTime.toISOString(), amount: r.amount, status: r.status, role: "debtor" });
    }
  }

  // Trim to role: players keep receivers + their own debtor lines only.
  let people: SettlementPersonView[];
  if (isManager) {
    people = [...peopleMap.values()];
  } else {
    const key = viewerEventPlayerName ? personKey(viewerEventPlayerName, true) : null;
    people = [...peopleMap.values()].filter((p) => p.isPayer || key === personKey(p.name, p.isPlayer));
    // Recompute amounts to drop other people's debtor amounts.
    people = people.map((p) => {
      if (p.isPayer) {
        p.lines = p.lines.filter((l) => l.role === "payer");
        return p;
      }
      return p;
    });
  }

  return {
    games: gameViews,
    people: people.sort((a, b) => b.owedToAmount - a.owedToAmount),
    currentGameId: event.currentGameId,
    viewerRole: viewer.role,
    viewerEventPlayerId,
    totals: {
      unsettledGames: gameViews.length,
      totalOwed: people.reduce((s, p) => s + p.owedAmount, 0),
      totalOwedTo: people.reduce((s, p) => s + p.owedToAmount, 0),
    },
  };
}

// ─── Current-game settlement (event page pills) ─────────────────────────────

export interface CurrentGameSettlement {
  gameId: string;
  mode: PaymentMode;
  payerName: string | null;
  payerIsPlayer: boolean;
  hasCost: boolean;
  rows: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }>;
}

/**
 * The event's current game payment state — all rows (paid/sent/pending), mode,
 * and payer. Used by the event-page payment section to render pills and the
 * "who paid this game?" config. Null when the event has no current game.
 */
export async function getCurrentGameSettlement(eventId: string): Promise<CurrentGameSettlement | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true },
  });
  if (!event?.currentGameId) return null;

  const game = await prisma.game.findUnique({
    where: { id: event.currentGameId },
    include: {
      payments: {
        where: { archivedAt: null },
        include: { eventPlayer: { select: { name: true } } },
        orderBy: { playerName: "asc" },
      },
      payerEventPlayer: { select: { id: true, name: true } },
    },
  });
  if (!game) return null;

  const { total } = await effectiveGameCost(game.id, eventId);
  const payerId = game.payerEventPlayerId;
  return {
    gameId: game.id,
    mode: (game.paymentMode as PaymentMode | null) ?? "tracked",
    payerName: game.payerEventPlayer?.name ?? game.payerExternalName,
    payerIsPlayer: !!game.payerEventPlayer,
    hasCost: total > 0,
    rows: game.payments.map((p) => ({
      eventPlayerId: p.eventPlayerId,
      name: p.eventPlayer.name,
      amount: p.amount,
      status: p.status,
      isPayer: payerId === p.eventPlayerId,
    })),
  };
}
