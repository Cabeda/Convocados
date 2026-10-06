import { prisma } from "./db.server";
import { validatePaymentMethods, normalizePaymentMethod } from "./paymentMethods";
import type { PaymentMethod } from "./paymentMethods";
import { syncGamePayments } from "./settlement.server";
import { perPlayerShare } from "./gameCost";

export interface SetCostInput {
  totalAmount: number;
  currency?: string;
  paymentDetails?: string | null;
  monthlyEnabled?: boolean;
  monthlyFeeCents?: number | null;
  monthlyGamesCovered?: number | null;
  dropInSurchargeCents?: number | null;
  paymentMethods?: PaymentMethod[] | null;
  scope?: "this_game" | "all_future";
}

export interface SetCostResult {
  ok: true;
  id: string;
  eventId: string;
  totalAmount: number;
  currency: string;
  paymentDetails: string | null;
  paymentMethods: string | null;
  monthlyEnabled: boolean | null;
  monthlyFeeCents: number | null;
  monthlyGamesCovered: number | null;
  dropInSurchargeCents: number | null;
  createdAt: string;
  updatedAt: string;
  scope: "this_game" | "all_future";
  payments: Array<{
    id: string;
    eventCostId: string;
    playerName: string;
    amount: number;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  gameOverride?: { costTotalAmount: number; costCurrency: string };
}

export async function setEventCost(
  eventId: string,
  input: SetCostInput,
): Promise<SetCostResult> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) throw new Error("Event not found");

  const totalAmount = input.totalAmount;
  if (!totalAmount || totalAmount <= 0) {
    throw new Error("totalAmount must be a positive number.");
  }
  const currency = String(input.currency ?? "EUR").trim().slice(0, 10) || "EUR";
  const paymentDetails = input.paymentDetails !== null && input.paymentDetails !== undefined
    ? String(input.paymentDetails).trim().slice(0, 500) || null
    : undefined;

  const monthlyEnabled = input.monthlyEnabled !== undefined ? Boolean(input.monthlyEnabled) : undefined;
  let monthlyFeeCents: number | null | undefined = undefined;
  if (input.monthlyFeeCents !== undefined && input.monthlyFeeCents !== null) {
    const n = Number(input.monthlyFeeCents);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("monthlyFeeCents must be a non-negative integer.");
    }
    monthlyFeeCents = n;
  }
  let monthlyGamesCovered: number | undefined = undefined;
  if (input.monthlyGamesCovered !== undefined && input.monthlyGamesCovered !== null) {
    const n = Number(input.monthlyGamesCovered);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error("monthlyGamesCovered must be a positive integer.");
    }
    monthlyGamesCovered = n;
  }
  let dropInSurchargeCents: number | undefined = undefined;
  if (input.dropInSurchargeCents !== undefined && input.dropInSurchargeCents !== null) {
    const n = Number(input.dropInSurchargeCents);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("dropInSurchargeCents must be a non-negative integer.");
    }
    dropInSurchargeCents = n;
  }

  let paymentMethodsJson: string | undefined;
  if (input.paymentMethods !== undefined) {
    if (input.paymentMethods === null || (Array.isArray(input.paymentMethods) && input.paymentMethods.length === 0)) {
      paymentMethodsJson = null as unknown as string;
    } else {
      const err = validatePaymentMethods(input.paymentMethods);
      if (err) throw new Error(err);
      const normalized = (input.paymentMethods as PaymentMethod[]).map(normalizePaymentMethod);
      paymentMethodsJson = JSON.stringify(normalized);
    }
  }

  const activePlayers = event.players.slice(0, event.maxPlayers);
  const share = perPlayerShare(totalAmount, event.maxPlayers);

  const scope = input.scope ?? "all_future";

  if (scope === "this_game") {
    if (!event.currentGameId) {
      throw new Error("No active game to override cost for.");
    }

    await prisma.game.update({
      where: { id: event.currentGameId },
      data: { costTotalAmount: totalAmount, costCurrency: currency },
    });

    let eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
    if (!eventCost) {
      eventCost = await prisma.eventCost.create({
        data: {
          eventId,
          totalAmount,
          currency,
          paymentDetails: paymentDetails ?? null,
          paymentMethods: paymentMethodsJson ?? null,
        },
      });
    }

    for (const player of activePlayers) {
      await prisma.playerPayment.upsert({
        where: {
          eventCostId_playerName: { eventCostId: eventCost.id, playerName: player.name },
        },
        create: {
          eventCostId: eventCost.id,
          playerName: player.name,
          amount: share,
        },
        update: { amount: share },
      });
    }

    const activeNames = new Set(activePlayers.map((p) => p.name));
    await prisma.playerPayment.deleteMany({
      where: { eventCostId: eventCost.id, playerName: { notIn: [...activeNames] } },
    });

    if (event.currentGameId) {
      await syncGamePayments(event.currentGameId, eventId);
    }

    const payments = await prisma.playerPayment.findMany({
      where: { eventCostId: eventCost.id },
      orderBy: { playerName: "asc" },
    });

    return {
      ok: true,
      ...eventCost,
      scope: "this_game",
      gameOverride: { costTotalAmount: totalAmount, costCurrency: currency },
      createdAt: eventCost.createdAt.toISOString(),
      updatedAt: eventCost.updatedAt.toISOString(),
      payments: payments.map((p) => ({
        ...p,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  const existing = await prisma.eventCost.findUnique({ where: { eventId } });

  let eventCost;
  if (existing) {
    eventCost = await prisma.eventCost.update({
      where: { id: existing.id },
      data: {
        totalAmount,
        currency,
        ...(paymentDetails !== undefined && { paymentDetails }),
        ...(paymentMethodsJson !== undefined && { paymentMethods: paymentMethodsJson }),
        ...(monthlyEnabled !== undefined && { monthlyEnabled }),
        ...(monthlyFeeCents !== undefined && { monthlyFeeCents }),
        ...(monthlyGamesCovered !== undefined && { monthlyGamesCovered }),
        ...(dropInSurchargeCents !== undefined && { dropInSurchargeCents }),
      },
    });
  } else {
    eventCost = await prisma.eventCost.create({
      data: {
        eventId,
        totalAmount,
        currency,
        paymentDetails: paymentDetails ?? null,
        paymentMethods: paymentMethodsJson ?? null,
        ...(monthlyEnabled !== undefined && { monthlyEnabled }),
        ...(monthlyFeeCents !== undefined && { monthlyFeeCents }),
        ...(monthlyGamesCovered !== undefined && { monthlyGamesCovered }),
        ...(dropInSurchargeCents !== undefined && { dropInSurchargeCents }),
      },
    });
  }

  for (const player of activePlayers) {
    await prisma.playerPayment.upsert({
      where: {
        eventCostId_playerName: { eventCostId: eventCost.id, playerName: player.name },
      },
      create: {
        eventCostId: eventCost.id,
        playerName: player.name,
        amount: share,
      },
      update: {
        amount: share,
      },
    });
  }

  const activeNames = new Set(activePlayers.map((p) => p.name));
  await prisma.playerPayment.deleteMany({
    where: {
      eventCostId: eventCost.id,
      playerName: { notIn: [...activeNames] },
    },
  });

  if (event.currentGameId) {
    await syncGamePayments(event.currentGameId, eventId);
  }

  const payments = await prisma.playerPayment.findMany({
    where: { eventCostId: eventCost.id },
    orderBy: { playerName: "asc" },
  });

  return {
    ok: true,
    ...eventCost,
    scope: "all_future",
    createdAt: eventCost.createdAt.toISOString(),
    updatedAt: eventCost.updatedAt.toISOString(),
    payments: payments.map((p) => ({
      ...p,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  };
}
