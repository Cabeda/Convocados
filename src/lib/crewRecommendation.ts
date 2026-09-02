export interface CrewRecommendationPlayer {
  membershipId: string;
  name: string;
  rating: number;
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

/**
 * Deterministically distribute Season participants into balanced Crews.
 * Membership IDs, rather than mutable player names, are the assignment key.
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

  const sortedPlayers = [...players].sort((a, b) =>
    b.rating - a.rating || a.membershipId.localeCompare(b.membershipId),
  );

  const ratingByMembershipId = new Map(sortedPlayers.map((player) => [player.membershipId, player.rating]));
  let direction = 1;
  let cursor = 0;
  for (const player of sortedPlayers) {
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

  const balanceScore = () => {
    const meanAverage = crews.reduce((sum, crew) => sum + crew.totalRating / crew.membershipIds.length, 0) / crews.length;
    return crews.reduce((sum, crew) => sum + (crew.totalRating / crew.membershipIds.length - meanAverage) ** 2, 0);
  };
  let score = balanceScore();
  let improved = true;
  while (improved) {
    improved = false;
    let bestSwap: { left: number; right: number; leftIndex: number; rightIndex: number; score: number } | null = null;
    for (let left = 0; left < crews.length; left += 1) {
      for (let right = left + 1; right < crews.length; right += 1) {
        for (let leftIndex = 0; leftIndex < crews[left].membershipIds.length; leftIndex += 1) {
          for (let rightIndex = 0; rightIndex < crews[right].membershipIds.length; rightIndex += 1) {
            const leftRating = ratingByMembershipId.get(crews[left].membershipIds[leftIndex]) ?? 0;
            const rightRating = ratingByMembershipId.get(crews[right].membershipIds[rightIndex]) ?? 0;
            crews[left].totalRating += rightRating - leftRating;
            crews[right].totalRating += leftRating - rightRating;
            const candidateScore = balanceScore();
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
