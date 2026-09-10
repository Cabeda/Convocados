package dev.convocados.ui.screen.event

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.convocados.R
import dev.convocados.data.api.TeamResult
import kotlin.math.roundToInt

private val PITCH_TOP = Color(0xFF2F8F4E)
private val PITCH_BOTTOM = Color(0xFF246F3D)
private val TOKEN_BG = Color(0xFFF7FBF8)
private val TOKEN_TEXT = Color(0xFF16241B)

private data class FieldDrag(
    val name: String,
    val fromTeam: Int,
    val basePitchFraction: Float,
    val offset: Offset,
)

/**
 * Field view of the randomized teams: two halves of a portrait sport pitch,
 * one per team. Dragging a token across the halfway line moves that player to
 * the other team (persisted through the teams API by the caller).
 */
@Composable
fun TeamFieldView(
    teams: List<TeamResult>,
    sport: String?,
    ratings: Map<String, Int>?,
    playerIds: Map<String, String>,
    canEdit: Boolean,
    onMove: (playerId: String, playerName: String, toTeamOne: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (teams.size != 2) return
    val formation = remember(sport) { defaultFormation(sport) }
    val slotCount = formation.slots.size
    var pitchHeight by remember { mutableIntStateOf(0) }
    var drag by remember { mutableStateOf<FieldDrag?>(null) }

    Box(
        modifier
            .fillMaxWidth()
            .height(360.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Brush.verticalGradient(listOf(PITCH_TOP, PITCH_BOTTOM)))
            .onSizeChanged { pitchHeight = it.height }
            .padding(8.dp),
    ) {
        Box(
            Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .height(2.dp)
                .background(Color.White.copy(alpha = 0.30f)),
        )
        Box(
            Modifier
                .align(Alignment.Center)
                .size(56.dp)
                .border(2.dp, Color.White.copy(alpha = 0.30f), RoundedCornerShape(50)),
        )
        Column(Modifier.fillMaxSize()) {
            teams.forEachIndexed { teamIndex, team ->
                TeamHalf(
                    team = team,
                    teamIndex = teamIndex,
                    formation = formation,
                    ratings = ratings,
                    playerIds = playerIds,
                    canEdit = canEdit,
                    drag = drag,
                    onDragStart = { name, slotIndex ->
                        val base = if (slotIndex in 0 until slotCount) {
                            basePitchFraction(teamIndex, formation.slots[slotIndex].x)
                        } else if (teamIndex == 0) 0.25f else 0.75f
                        drag = FieldDrag(name, teamIndex, base, Offset.Zero)
                    },
                    onDrag = { delta -> drag = drag?.copy(offset = drag!!.offset + delta) },
                    onDragEnd = {
                        val active = drag
                        drag = null
                        if (active != null) {
                            val target = targetTeamForDrag(active.basePitchFraction, active.offset.y, pitchHeight)
                            if (target >= 0 && target != active.fromTeam) {
                                playerIds[active.name]?.let { pid ->
                                    onMove(pid, active.name, target == 0)
                                }
                            }
                        }
                    },
                    onDragCancel = { drag = null },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun TeamHalf(
    team: TeamResult,
    teamIndex: Int,
    formation: Formation,
    ratings: Map<String, Int>?,
    playerIds: Map<String, String>,
    canEdit: Boolean,
    drag: FieldDrag?,
    onDragStart: (name: String, slotIndex: Int) -> Unit,
    onDrag: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val slotCount = formation.slots.size
    val members = team.members
    val placed = members.take(slotCount)
    val unplaced = members.drop(slotCount)

    Column(
        modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.05f))
            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(12.dp))
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                team.name,
                color = Color.White,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                "${members.size}",
                color = Color.White.copy(alpha = 0.8f),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            placed.forEachIndexed { slotIndex, member ->
                val slot = formation.slots[slotIndex]
                val xFraction = slot.y
                val yFraction = if (teamIndex == 0) slot.x else 1f - slot.x
                PlayerToken(
                    name = member.name,
                    rating = ratings?.get(member.name),
                    draggable = canEdit && playerIds.containsKey(member.name),
                    dragging = drag?.name == member.name,
                    dragOffset = if (drag?.name == member.name) drag.offset else Offset.Zero,
                    onDragStart = { onDragStart(member.name, slotIndex) },
                    onDrag = onDrag,
                    onDragEnd = onDragEnd,
                    onDragCancel = onDragCancel,
                    modifier = Modifier.align(BiasAlignment(2f * xFraction - 1f, 2f * yFraction - 1f)),
                )
            }
        }
        if (unplaced.isNotEmpty()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    stringResource(R.string.unplaced_players),
                    color = Color.White.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                unplaced.forEach { member ->
                    PlayerToken(
                        name = member.name,
                        rating = ratings?.get(member.name),
                        draggable = canEdit && playerIds.containsKey(member.name),
                        dragging = drag?.name == member.name,
                        dragOffset = if (drag?.name == member.name) drag.offset else Offset.Zero,
                        onDragStart = { onDragStart(member.name, -1) },
                        onDrag = onDrag,
                        onDragEnd = onDragEnd,
                        onDragCancel = onDragCancel,
                    )
                }
            }
        }
    }
}

@Composable
private fun PlayerToken(
    name: String,
    rating: Int?,
    draggable: Boolean,
    dragging: Boolean,
    dragOffset: Offset,
    onDragStart: () -> Unit,
    onDrag: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val dragModifier = if (draggable) {
        Modifier.pointerInput(name) {
            detectDragGestures(
                onDragStart = { onDragStart() },
                onDrag = { change, delta ->
                    change.consume()
                    onDrag(delta)
                },
                onDragEnd = { onDragEnd() },
                onDragCancel = { onDragCancel() },
            )
        }
    } else {
        Modifier
    }
    Row(
        modifier
            .offset { IntOffset(dragOffset.x.roundToInt(), dragOffset.y.roundToInt()) }
            .zIndex(if (dragging) 2f else 1f)
            .alpha(if (dragging) 0.85f else 1f)
            .clip(RoundedCornerShape(50))
            .background(TOKEN_BG)
            .then(dragModifier)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            name,
            color = TOKEN_TEXT,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (rating != null) {
            Text(
                "$rating",
                color = TOKEN_TEXT.copy(alpha = 0.55f),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
            )
        }
    }
}
