/**
 * Rebuild GameParticipant.order for games whose active rows carry duplicate
 * orders.
 *
 * The roster API sorts by `order` and returns ties in physical row order, so a
 * duplicate (0,0,1,1,...) reshuffles the list on every fetch — the webhook and
 * the app then disagree about who is first. Duplicates came from teams
 * snapshots writing the WITHIN-TEAM member index onto GameParticipant.order
 * (fixed in src/lib/gameDualWrite.server.ts).
 *
 * Rebuild rule: legacy Player.order (the join queue — append on join, re-index
 * on leave, move-to-end on re-add), then EventPlayer.createdAt, then name.
 * Active/bench falls out of the rebuilt contiguous 0..n-1 (bench = order >=
 * maxPlayers). Caveat: a live priority eviction is reverted to join order; the
 * next priority confirm re-applies it.
 *
 * Games with unique orders are skipped, so the script is idempotent. By
 * default only games that are an event's currentGameId are touched (those are
 * the rosters people actually see); --all also covers historical games.
 *
 * Usage:
 *   npm run db:repair:participant-order                    # dry run (current games)
 *   npm run db:repair:participant-order -- --all --apply   # every game, write
 *   npx tsx scripts/repair-game-participant-order.ts --game <gameId> --apply
 */
import { prisma, prismaReady } from "../src/lib/db.server";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const allGames = argv.includes("--all");
const gameArg = argv.indexOf("--game");
const onlyGameId = gameArg >= 0 ? argv[gameArg + 1] : null;

async function main() {
  // The WAL/PRAGMA bootstrap races a first query issued before it settles
  // ("Safety level may not be changed inside a transaction").
  await prismaReady;

  const scope = onlyGameId
    ? { gameId: onlyGameId }
    : allGames
      ? {}
      : {
          gameId: {
            in: (
              await prisma.event.findMany({
                where: { currentGameId: { not: null } },
                select: { currentGameId: true },
              })
            ).flatMap((e) => (e.currentGameId ? [e.currentGameId] : [])),
          },
        };

  const rows = await prisma.gameParticipant.findMany({
    where: {
      archivedAt: null,
      status: { not: "pending" },
      ...scope,
    },
    include: { eventPlayer: { select: { name: true, createdAt: true, eventId: true } } },
    orderBy: [{ gameId: "asc" }, { order: "asc" }],
  });

  const byGame = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byGame.get(row.gameId) ?? [];
    list.push(row);
    byGame.set(row.gameId, list);
  }

  const dupGames = [...byGame.entries()].filter(
    ([, list]) => new Set(list.map((r) => r.order)).size !== list.length,
  );

  if (!dupGames.length) {
    console.log("No games with duplicate active GameParticipant.order. Nothing to do.");
    return;
  }

  console.log(
    `Found ${dupGames.length} game(s) with duplicate order (${onlyGameId ? "one game" : allGames ? "all games" : "current games"}${apply ? "" : ", dry run"}).`,
  );

  let changed = 0;
  for (const [gameId, list] of dupGames) {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { dateTime: true, event: { select: { title: true, maxPlayers: true } } },
    });
    const eventId = list[0].eventPlayer.eventId;
    const players = await prisma.player.findMany({
      where: { eventId, archivedAt: null },
      select: { name: true, order: true },
    });
    const joinOrder = new Map(players.map((p) => [p.name, p.order]));

    const sorted = [...list].sort((a, b) => {
      const ao = joinOrder.get(a.eventPlayer.name) ?? Number.MAX_SAFE_INTEGER;
      const bo = joinOrder.get(b.eventPlayer.name) ?? Number.MAX_SAFE_INTEGER;
      return (
        ao - bo ||
        a.eventPlayer.createdAt.getTime() - b.eventPlayer.createdAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.eventPlayer.name.localeCompare(b.eventPlayer.name)
      );
    });

    const before = sorted.map((r) => `${r.order}:${r.eventPlayer.name}`).join("  ");
    const after = sorted.map((r, i) => `${i}:${r.eventPlayer.name}`).join("  ");

    console.log(
      `\n${game?.event?.title ?? "?"} · ${game?.dateTime.toISOString().slice(0, 16).replace("T", " ")} · game ${gameId} (max ${game?.event?.maxPlayers ?? "?"})`,
    );
    console.log(`  before: ${before}`);
    console.log(`  after:  ${after}`);

    if (!apply) continue;
    for (const [i, row] of sorted.entries()) {
      if (row.order === i) continue;
      await prisma.gameParticipant.update({ where: { id: row.id }, data: { order: i } });
      changed++;
    }
  }

  if (!apply) {
    console.log(`\nDry run — no writes. Re-run with --apply to rebuild ${dupGames.length} game(s).`);
  } else {
    console.log(`\n✓ Rebuilt orders for ${dupGames.length} game(s) (${changed} row(s) updated).`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
