package dev.convocados.ui.screen.event

import dev.convocados.data.api.TeamMember

/** A member occupying one specific slot of a team's formation. */
data class PlacedMember(val slot: Int, val member: TeamMember)

/**
 * Where a team's members sit on its formation: the members that own a slot, in
 * slot order, and the members that own none.
 */
data class TeamLayout(
    val placed: List<PlacedMember>,
    val unplaced: List<TeamMember>,
)

/**
 * Place a team's members on its formation slots the way the web's `TeamField`
 * does: a member owns the slot the server stored for them
 * (`isPlaced = typeof p.slot === "number" && p.slot < slotCount`), and a member
 * with no stored slot is on the bench.
 *
 * One exception keeps legacy teams readable: a cached team that predates slots
 * — no member has one at all — is laid out by `order`, exactly as it rendered
 * before the slot dimension existed. The web reaches the same render through
 * `normalizeSlots`, which fills free slots by `order`.
 */
fun applyFormationLayout(members: List<TeamMember>, slotCount: Int): TeamLayout {
    if (members.isNotEmpty() && members.none { it.slot != null }) {
        val ordered = members.sortedBy { it.order }
        return TeamLayout(
            placed = ordered.take(slotCount).mapIndexed { slot, member -> PlacedMember(slot, member) },
            unplaced = ordered.drop(slotCount),
        )
    }

    val placements = mutableMapOf<Int, TeamMember>()
    val unplaced = mutableListOf<TeamMember>()
    members.forEach { member ->
        val slot = member.slot
        if (slot != null && slot in 0 until slotCount && !placements.containsKey(slot)) {
            placements[slot] = member
        } else {
            unplaced += member
        }
    }
    return TeamLayout(
        placed = placements.toSortedMap().map { (slot, member) -> PlacedMember(slot, member) },
        unplaced = unplaced,
    )
}
