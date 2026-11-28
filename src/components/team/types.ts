/** A player's Crew, or null for a Season participant without one (free agent). */
export interface CrewRef {
  crewId: string;
  crewName: string;
}

/** The selected scenario's projection for one lineup player. */
export interface PlayerStake {
  contribution: number;
  rpDelta: number;
  passed: number;
  provisional: boolean;
}

/** A Crew's projected bottom line for a team half's header chip. */
export interface CrewHeaderChip {
  crewId: string;
  name: string;
  roundScore: number;
  positionAfter: number;
  passed: number;
}
