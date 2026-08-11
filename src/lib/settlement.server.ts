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
 * maxPlayers (the required playing slots). The per-player price is fixed — the
 * current roster size (or bench overflow) does not change it.
 *
 * Settle actions dual-write to the WalletTransaction ledger (recordReceived) so
 * the join-gate / outstanding-balance stays consistent.
 */
import { prisma, Prisma } from "./db.server";
import { recordReceived } from "./payments.server";

export type PaymentMode = "tracked" | "untracked";

/** One player's payment row in a game view. */
export interface SettlementRow {
  eventPlayerId: string;
  name: string;
  amount: number;
  status: string;
  isPayer: boolean;
}

export interface EffectiveCost {
  total: number;
  currency: string;
  mode: PaymentMode;
  maxPlayers: number;
}

/** Effective cost + mode for a game. mode defaults to tracked (null column). */
export async function effectiveGameCost(gameId: string, eventId: string): Promise<EffectiveCost> {
  const [game, eventCost, event] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId }, select: { costTotalAmount: true, costCurrency: true, paymentMode: true } }),
    prisma.eventCost.findUnique({ where: { eventId }, select: { totalAmount: true, currency: true } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { maxPlayers: true } }),
  ]);
  return {
    total: game?.costTotalAmount ?? eventCost?.totalAmount ?? 0,
    currency: game?.costCurrency ?? eventCost?.currency ?? "EUR",
    mode: (game?.paymentMode as PaymentMode | null) ?? "tracked",
    maxPlayers: event?.maxPlayers ?? 1,
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

/** Whether a user is an event player (has an EventPlayer linked to the event). */
export async function isEventParticipant(eventId: string, userId: string): Promise<boolean> {
  const ep = await prisma.eventPlayer.findFirst({ where: { eventId, userId }, select: { id: true } });
  return !!ep;
}

/**
 * Per-participant share in euros (2dp), 0 when no cost or no participants.
 * The denominator is maxPlayers (the required playing slots) — the per-player
 * price is a fixed attribute of the event and does not change with how many
 * players are currently on the roster. Callers without a maxPlayers value
 * fall back to the participant count.
 */
export function shareFor(total: number, participantsCount: number, maxPlayers = participantsCount): number {
  if (participantsCount <= 0) return 0;
  return Math.round((total / Math.max(1, maxPlayers)) * 100) / 100;
}

/** Minimal client shape the sync routine needs — a `prisma` instance or a tx client. */
type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Reconcile GamePayment rows for a game against its active participants.
 * - Creates/revives a pending row for each participant at the current share.
 * - Archives rows for participants no longer active (soft, keeps history).
 * - Untracked games get no rows.
 * - Re-applies payer auto-settlement when the payer is an active participant.
 * - Played games: amounts/rows are frozen — only payer auto-settle/revert applies.
 */
async function syncGamePaymentsCore(db: DbClient, gameId: string, eventId: string): Promise<void> {
  const [effective, game, participants] = await Promise.all([
    effectiveGameCost(gameId, eventId),
    db.game.findUnique({ where: { id: gameId }, select: { payerEventPlayerId: true, status: true } }),
    db.gameParticipant.findMany({
      where: { gameId, archivedAt: null },
      include: { eventPlayer: { select: { id: true, name: true, userId: true } } },
      orderBy: { order: "asc" },
    }),
  ]);
  const { total, mode, maxPlayers } = effective;
  const share = shareFor(total, participants.length, maxPlayers);

  // Revert rows auto-settled as payer that are no longer the payer, then settle
  // the current player-payer. Runs for played games too (payer changes post-game).
  const applyPayer = async () => {
    await db.gamePayment.updateMany({
      where: {
        gameId,
        method: "payer",
        ...(game?.payerEventPlayerId ? { eventPlayerId: { not: game.payerEventPlayerId } } : {}),
      },
      data: { status: "pending", paidAt: null, method: null },
    });
    if (game?.payerEventPlayerId) {
      await db.gamePayment.updateMany({
        where: { gameId, eventPlayerId: game.payerEventPlayerId },
        data: { status: "paid", paidAt: new Date(), method: "payer" },
      });
    }
  };

  if (mode === "untracked" || total <= 0) {
    await db.gamePayment.deleteMany({ where: { gameId } });
    return;
  }

  const activeIds = participants.map((p) => p.eventPlayer.id);
  await db.gamePayment.updateMany({
    where: { gameId, eventPlayerId: { notIn: activeIds } },
    data: { archivedAt: new Date() },
  });

  // Played games: shares are frozen once the game ends (spec point 4) — rows
  // are created/revived at the frozen share but amounts never change, so a
  // post-game roster mutation can't rewrite what the group already settled.
  const amountUpdate = game?.status === "played" ? {} : { amount: share };
  for (const p of participants) {
    await db.gamePayment.upsert({
      where: { gameId_eventPlayerId: { gameId, eventPlayerId: p.eventPlayer.id } },
      create: {
        gameId,
        eventPlayerId: p.eventPlayer.id,
        playerName: p.eventPlayer.name,
        amount: share,
        status: "pending",
      },
      update: { archivedAt: null, playerName: p.eventPlayer.name, ...amountUpdate },
    });
  }

  await applyPayer();
}

export async function syncGamePayments(gameId: string, eventId: string): Promise<void> {
  await syncGamePaymentsCore(prisma, gameId, eventId);
}

export async function syncGamePaymentsTx(tx: Prisma.TransactionClient, gameId: string, eventId: string): Promise<void> {
  await syncGamePaymentsCore(tx, gameId, eventId);
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
  if (hasPlayerPayer && hasExternal) {
    throw new Error("A tracked game has at most one payer (a player or an external name).");
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
  if (payment.status === "paid") throw new Error("Share is already settled.");
  if (payment.method === "payer") throw new Error("The payer's share is auto-settled and cannot be re-settled.");

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

/**
 * Revert a settled share back to pending (owner/admin undo a mistaken settle).
 * Only manually-settled rows (not auto-settled payer rows) can be reverted.
 * Also removes the `payment_received` ledger credit so the join-gate balance
 * stays consistent with the reverted state.
 */
export async function unsettleShare(
  eventId: string,
  gameId: string,
  eventPlayerId: string,
): Promise<void> {
  const payment = await prisma.gamePayment.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
  });
  if (!payment) throw new Error("Payment not found for this game and player.");
  if (payment.method === "payer") {
    throw new Error("The payer's share is auto-settled and cannot be reverted.");
  }

  const ep = await prisma.eventPlayer.findUnique({ where: { id: eventPlayerId } });

  // Resolve the ledger userId the same way recordReceived does: the player's
  // linked user, else the per-(event,player) system user.
  const ledgerUserId = ep?.userId ?? (payment.playerName ? `system:${eventId}:${payment.playerName}` : null);

  await prisma.$transaction(async (tx) => {
    await tx.gamePayment.update({
      where: { id: payment.id },
      data: { status: "pending", paidAt: null, method: null, markedBy: null },
    });
    if (ledgerUserId) {
      await tx.walletTransaction.deleteMany({
        where: { eventId, eventInstanceId: gameId, reason: "payment_received", userId: ledgerUserId },
      });
    }
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
  rows: SettlementRow[];
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
  /** Active participants of the current game — informational. */
  activePlayerCount: number;
  /** Required playing slots — drives the fixed per-player share display. */
  maxPlayers: number;
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
    select: { id: true, currentGameId: true, maxPlayers: true },
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
      // Privacy: a non-manager never sees other debtors' names/amounts — only
      // their own row (receivers/payers stay public via `payerName`).
      rows: activeRows
        .filter((r) => isManager || r.eventPlayerId === viewerEventPlayerId)
        .map((r) => ({
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
    // Other people's debtor lines are private — show only their public "receiver"
    // (payer) side. The viewer's own person keeps ALL lines (they may be both a
    // payer in one game and a debtor in another).
    people = people.map((p) => {
      if (p.isPayer && key !== personKey(p.name, p.isPlayer)) {
        p.lines = p.lines.filter((l) => l.role === "payer");
      }
      return p;
    });
  }

  // Active participant count of the current game — drives the per-share display.
  let activePlayerCount = 0;
  if (event.currentGameId) {
    activePlayerCount = await prisma.gameParticipant.count({
      where: { gameId: event.currentGameId, archivedAt: null },
    });
  }

  return {
    games: gameViews,
    people: people.sort((a, b) => b.owedToAmount - a.owedToAmount),
    currentGameId: event.currentGameId,
    viewerRole: viewer.role,
    viewerEventPlayerId,
    activePlayerCount,
    maxPlayers: event.maxPlayers,
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
  rows: SettlementRow[];
}

/**
 * Build settlement rows for a game from its ACTIVE PARTICIPANTS, using synced
 * GamePayment rows when present. Derived from participants so the payer picker
 * always lists everyone on the roster — even before payment rows are synced
 * (e.g. a cost set after players joined, or an untracked game switching back).
 */
export function buildSettlementRows(
  game: { payerEventPlayerId: string | null; payments: Array<{ eventPlayerId: string; amount: number; status: string }> },
  participants: Array<{ eventPlayer: { id: string; name: string } }>,
  total: number,
  maxPlayers: number,
): SettlementRow[] {
  const share = shareFor(total, participants.length, maxPlayers);
  const paymentByPlayer = new Map(game.payments.map((p) => [p.eventPlayerId, p]));
  return participants.map((gp) => {
    const row = paymentByPlayer.get(gp.eventPlayer.id);
    const isPayer = game.payerEventPlayerId === gp.eventPlayer.id;
    return {
      eventPlayerId: gp.eventPlayer.id,
      name: gp.eventPlayer.name,
      amount: row?.amount ?? share,
      // A player-payer's computed row reads as auto-settled even before rows sync.
      status: row?.status ?? (isPayer ? "paid" : "pending"),
      isPayer,
    };
  });
}

/** Payment config + rows for any single game (current, played, or untracked). */
export async function getGameSettlement(eventId: string, gameId: string): Promise<CurrentGameSettlement | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
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

  const { total, maxPlayers } = await effectiveGameCost(game.id, eventId);
  const participants = await prisma.gameParticipant.findMany({
    where: { gameId: game.id, archivedAt: null },
    include: { eventPlayer: { select: { id: true, name: true } } },
    orderBy: { order: "asc" },
  });

  return {
    gameId: game.id,
    mode: (game.paymentMode as PaymentMode | null) ?? "tracked",
    payerName: game.payerEventPlayer?.name ?? game.payerExternalName,
    payerIsPlayer: !!game.payerEventPlayer,
    hasCost: total > 0,
    rows: buildSettlementRows(game, participants, total, maxPlayers),
  };
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
  return getGameSettlement(eventId, event.currentGameId);
}

// ─── Wrap-up game payments (post-game banner) ───────────────────────────────

export interface WrapUpGameSettlement {
  gameId: string;
  mode: PaymentMode;
  payerName: string | null;
  payerIsPlayer: boolean;
  rows: SettlementRow[];
}

/**
 * The game the post-game banner settles: the event's current game when it has
 * ended (not yet reset), otherwise the most recent played game. Returns its
 * GamePayment rows + config, or null when there is nothing to settle (no game,
 * untracked, or no payment rows). Used by post-game-status so the banner pills
 * reflect the durable per-game model.
 */
export async function getWrapUpGameSettlement(eventId: string): Promise<WrapUpGameSettlement | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true, dateTime: true },
  });
  if (!event) return null;

  const endedNow = event.currentGameId
    ? await prisma.game.findFirst({
        where: { id: event.currentGameId, status: "played" },
        include: { payments: { include: { eventPlayer: { select: { name: true } } } }, payerEventPlayer: { select: { id: true, name: true } } },
      })
    : null;

  const game = endedNow ?? (await prisma.game.findFirst({
    where: { eventId, status: "played" },
    orderBy: { dateTime: "desc" },
    include: { payments: { include: { eventPlayer: { select: { name: true } } } }, payerEventPlayer: { select: { id: true, name: true } } },
  }));

  if (!game) return null;
  const mode = (game.paymentMode as PaymentMode | null) ?? "tracked";

  // Untracked ("each one pays their own share"): everyone is settled by
  // definition — the banner must show payments as done instead of asking to
  // settle each player. Only reported when the game has a cost; otherwise
  // there is nothing to settle and the old null behaviour applies.
  if (mode === "untracked") {
    const { total } = await effectiveGameCost(game.id, eventId);
    if (total <= 0) return null;
    return { gameId: game.id, mode, payerName: null, payerIsPlayer: false, rows: [] };
  }

  const payerId = game.payerEventPlayerId;
  const activeRows = game.payments.filter((p) => !p.archivedAt);
  if (activeRows.length === 0) return null;

  return {
    gameId: game.id,
    mode,
    payerName: game.payerEventPlayer?.name ?? game.payerExternalName,
    payerIsPlayer: !!game.payerEventPlayer,
    rows: activeRows.map((p) => ({
      eventPlayerId: p.eventPlayerId,
      name: p.eventPlayer.name,
      amount: p.amount,
      status: p.status,
      isPayer: payerId === p.eventPlayerId,
    })),
  };
}
