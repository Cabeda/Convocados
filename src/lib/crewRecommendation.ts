export interface CrewRecommendationPlayer {
  membershipId: string;
  name: string;
  rating: number;
  /** Games attended in the analysis window (e.g. the last 12 months). */
  gamesPlayed?: number;
  /** Crew the participant belonged to in the most recent previous season. */
  previousCrewId?: string | null;
}

export interface RecommendedCrew {
  name: string;
  membershipIds: string[];
  averageRating: number;
}

export interface CrewRecommendation {
  crews: RecommendedCrew[];
  errors: string[];
}

const MIN_CREW_SIZE = 3;
const MAX_CREW_SIZE = 5;
// Weight applied per player displaced from their previous-season Crew during
// the balance optimizer. Rating imbalance is measured in (rating diff)^2, so
// a few hundred per displaced player keeps "small changes" the tie-breaker
// while still letting the optimizer fix genuinely skewed ratings.
const STABILITY_WEIGHT = 500;

/**
 * Deterministically distribute Season participants into balanced Crews.
 * Membership IDs, rather than mutable player names, are the assignment key.
 *
 * When season history is supplied (gamesPlayed / previousCrewId) the draft:
 *   1. Reuses previous-season Crews: participants who attended recent games
 *      stay grouped with the members they already played with.
 *   2. Treats participants who stopped attending as free agents — they do not
 *      anchor a Crew.
 *   3. Splits oversized previous Crews across several Crews.
 *   4. Only displaces players when it meaningfully improves rating balance.
 */
export function recommendCrews(
  players: readonly CrewRecommendationPlayer[],
  crewCount: number,
): CrewRecommendation {
  const errors: string[] = [];
  if (!Number.isInteger(crewCount) || crewCount < 2) {
    errors.push("Crew count must be at least 2.");
  }
  if (players.length === 0) errors.push("At least one participant is required.");
  if (new Set(players.map((player) => player.membershipId)).size !== players.length) {
    errors.push("Participant membership IDs must be unique.");
  }
  if (errors.length > 0) return { crews: [], errors };

  const minimum = crewCount * MIN_CREW_SIZE;
  const maximum = crewCount * MAX_CREW_SIZE;
  if (players.length < minimum || players.length > maximum) {
    return {
      crews: [],
      errors: [`${crewCount} Crews require between ${minimum} and ${maximum} participants.`],
    };
  }

  const baseSize = Math.floor(players.length / crewCount);
  const extraMembers = players.length % crewCount;
  const targetSizes = Array.from({ length: crewCount }, (_, index) => baseSize + (index < extraMembers ? 1 : 0));

  const crews = targetSizes.map((targetSize, index) => ({
    name: `Crew ${index + 1}`,
    targetSize,
    membershipIds: [] as string[],
    totalRating: 0,
  }));
  const homeCrewByMembershipId = new Map<string, number>();

  const sortedPlayers = [...players].sort((a, b) =>
    b.rating - a.rating || a.membershipId.localeCompare(b.membershipId),
  );

  // ── Seed phase: reuse previous-season Crews (active attenders only). ─────
  const groups = new Map<string, CrewRecommendationPlayer[]>();
  for (const player of sortedPlayers) {
    if (player.previousCrewId && (player.gamesPlayed ?? 0) > 0) {
      const group = groups.get(player.previousCrewId);
      if (group) group.push(player);
      else groups.set(player.previousCrewId, [player]);
    }
  }
  const seededMembershipIds = new Set<string>();
  for (const group of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const members = group[1].sort((a, b) => b.rating - a.rating || a.membershipId.localeCompare(b.membershipId));
    while (members.length > 0) {
      // Prefer the Crew with the most free slots; ties break on lowest total
      // rating so seeding stays rating-aware, then on Crew index.
      let bestCrew = 0;
      for (let index = 1; index < crews.length; index += 1) {
        const current = crews[index];
        const best = crews[bestCrew];
        const free = current.targetSize - current.membershipIds.length;
        const bestFree = best.targetSize - best.membershipIds.length;
        if (free > bestFree || (free === bestFree && (current.totalRating < best.totalRating || (current.totalRating === best.totalRating && index < bestCrew)))) {
          bestCrew = index;
        }
      }
      const best = crews[bestCrew];
      const freeSlots = best.targetSize - best.membershipIds.length;
      const take = Math.min(freeSlots, members.length);
      for (const member of members.splice(0, take)) {
        best.membershipIds.push(member.membershipId);
        best.totalRating += member.rating;
        homeCrewByMembershipId.set(member.membershipId, bestCrew);
        seededMembershipIds.add(member.membershipId);
      }
    }
  }

  // ── Fill phase: everyone else (new players + inactive ones) snake-drafts ──
  // into the remaining slots, exactly like the history-free path.
  const ratingByMembershipId = new Map(sortedPlayers.map((player) => [player.membershipId, player.rating]));
  let direction = 1;
  let cursor = 0;
  for (const player of sortedPlayers) {
    if (seededMembershipIds.has(player.membershipId)) continue;
    const available = crews.filter((crew) => crew.membershipIds.length < crew.targetSize);
    const ordered = direction === 1 ? available : [...available].reverse();
    const crew = ordered[cursor % ordered.length];
    crew.membershipIds.push(player.membershipId);
    crew.totalRating += player.rating;
    cursor += 1;
    if (cursor >= crews.length) {
      cursor = 0;
      direction *= -1;
    }
  }

  const displacement = () => {
    let count = 0;
    for (const crew of crews) {
      for (const membershipId of crew.membershipIds) {
        const home = homeCrewByMembershipId.get(membershipId);
        if (home !== undefined && home !== crews.indexOf(crew)) count += 1;
      }
    }
    return count;
  };
  const balanceScore = () => {
    const meanAverage = crews.reduce((sum, crew) => sum + crew.totalRating / crew.membershipIds.length, 0) / crews.length;
    return crews.reduce((sum, crew) => sum + (crew.totalRating / crew.membershipIds.length - meanAverage) ** 2, 0);
  };
  const totalScore = () => balanceScore() + STABILITY_WEIGHT * displacement();
  let score = totalScore();
  let improved = true;
  while (improved) {
    improved = false;
    let bestSwap: { left: number; right: number; leftIndex: number; rightIndex: number; score: number } | null = null;
    for (let left = 0; left < crews.length; left += 1) {
      for (let right = left + 1; right < crews.length; right += 1) {
        for (let leftIndex = 0; leftIndex < crews[left].membershipIds.length; leftIndex += 1) {
          for (let rightIndex = 0; rightIndex < crews[right].membershipIds.length; rightIndex += 1) {
            const leftId = crews[left].membershipIds[leftIndex];
            const rightId = crews[right].membershipIds[rightIndex];
            const leftRating = ratingByMembershipId.get(leftId) ?? 0;
            const rightRating = ratingByMembershipId.get(rightId) ?? 0;
            // Simulate the swap on both totals and positions so the
            // displacement term sees the real candidate layout.
            crews[left].membershipIds[leftIndex] = rightId;
            crews[right].membershipIds[rightIndex] = leftId;
            crews[left].totalRating += rightRating - leftRating;
            crews[right].totalRating += leftRating - rightRating;
            const candidateScore = totalScore();
            crews[left].membershipIds[leftIndex] = leftId;
            crews[right].membershipIds[rightIndex] = rightId;
            crews[left].totalRating += leftRating - rightRating;
            crews[right].totalRating += rightRating - leftRating;
            if (candidateScore < score && (!bestSwap || candidateScore < bestSwap.score)) {
              bestSwap = { left, right, leftIndex, rightIndex, score: candidateScore };
            }
          }
        }
      }
    }
    if (bestSwap) {
      const leftCrew = crews[bestSwap.left];
      const rightCrew = crews[bestSwap.right];
      const leftId = leftCrew.membershipIds[bestSwap.leftIndex];
      leftCrew.membershipIds[bestSwap.leftIndex] = rightCrew.membershipIds[bestSwap.rightIndex];
      rightCrew.membershipIds[bestSwap.rightIndex] = leftId;
      const leftRating = ratingByMembershipId.get(leftId) ?? 0;
      const rightRating = ratingByMembershipId.get(leftCrew.membershipIds[bestSwap.leftIndex]) ?? 0;
      leftCrew.totalRating += rightRating - leftRating;
      rightCrew.totalRating += leftRating - rightRating;
      score = bestSwap.score;
      improved = true;
    }
  }

  return {
    crews: crews.map(({ name, membershipIds, totalRating }) => ({
      name,
      membershipIds,
      averageRating: totalRating / membershipIds.length,
    })),
    errors,
  };
}
