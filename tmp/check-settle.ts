import { getSettlementSummary } from "../src/lib/settlement.server";
import { computeHomeActions } from "../src/lib/homeActions.server";

async function main() {
  const userId = "lT5XljGaCRASAzUMzXwrk8wSY0JE1NbY";
  const eventId = "cmmkfrx8b0000o2ixrix1yp2m";

  const actions = await computeHomeActions(userId);
  console.log("PAY_SHARE ACTIONS:", JSON.stringify(actions.filter(a=>a.type==="pay_share"), null, 2));

  const s = await getSettlementSummary(eventId, { role: "player", userId });
  console.log("GAMES:", s.games.length);
  console.log(JSON.stringify(s.games, null, 2));
  console.log("PEOPLE:", JSON.stringify(s.people, null, 2));
  console.log("TOTALS:", JSON.stringify(s.totals));
}
main().then(() => process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
