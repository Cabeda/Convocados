package dev.convocados.ui.screen.rankings

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.convocados.R
import dev.convocados.data.api.SeasonRankMovement
import dev.convocados.data.api.SeasonRankStanding
import dev.convocados.util.jsNumber

private const val COUNT_MS = 900
private const val UNLOCK_TOTAL = 3

/**
 * The viewer's Season Rank section for the just-played Game, in two states:
 *
 *  - **standing** (no score yet): where the player sits right now, with a cue
 *    that scoring this Game is what moves it. No delta — nothing moved yet.
 *  - **movement** (scored): the before→after count-up, RP delta and tier-up,
 *    exactly as the reveal has always behaved.
 *
 * Both states carry the viewer's Crew placement and a link straight to the
 * Season page. Mirrors the web `SeasonRankReveal`. [inline] strips the card
 * chrome so it can share its parent's result card.
 */
@Composable
fun SeasonRankReveal(
    rank: SeasonRankMovement?,
    standing: SeasonRankStanding?,
    onWhyClick: () -> Unit,
    onViewSeason: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    inline: Boolean = false,
    animate: Boolean = true,
) {
    val counted = rank?.counted == true
    if (!counted && standing == null) return
    val seasonId = (if (counted) rank?.seasonId else standing?.seasonId).orEmpty()
    if (seasonId.isEmpty()) return

    val whyAria = stringResource(R.string.post_game_rank_why_aria)
    val dismissLabel = stringResource(R.string.post_game_rank_dismiss)
    val seasonName = (if (counted) rank?.seasonName else standing?.seasonName).orEmpty()
    val viewSeasonAria = stringResource(R.string.post_game_rank_view_season_aria, seasonName)
    val provisional = if (counted) requireNotNull(rank).provisional else requireNotNull(standing).provisional
    val gamesThisSeason = if (counted) requireNotNull(rank).gamesThisSeason else requireNotNull(standing).gamesThisSeason
    val edges = if (counted) requireNotNull(rank).edges else requireNotNull(standing).edges
    val tier = if (counted) requireNotNull(rank).tierAfter else requireNotNull(standing).tier
    val settledRank = if (counted) requireNotNull(rank).after else requireNotNull(standing).rank
    val tierName = RankTierNames.getOrElse(tier) { RankTierNames.first() }
    val tierColor = RankTierColors.getOrElse(tier) { RankTierColors.first() }
    val crew = standing?.crew

    val positive = counted && rank != null && rank.delta > 0
    val negative = counted && rank != null && rank.delta < 0
    val deltaColor = when {
        positive -> MaterialTheme.colorScheme.primary
        negative -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val deltaLabel = (if (positive) "+" else "") + jsNumber(rank?.delta ?: 0.0)

    // Count-up from before -> after on first view. A standing never animates:
    // there is no movement to feel, and counting up would imply one.
    var started by remember(seasonId, settledRank) { mutableStateOf(!animate || !counted) }
    val shownRank by animateIntAsState(
        targetValue = if (started || !counted) settledRank.toInt() else requireNotNull(rank).before.toInt(),
        animationSpec = tween(COUNT_MS, easing = FastOutSlowInEasing),
        label = "seasonRankValue",
    )
    val lo = edges.getOrNull(tier) ?: 0.0
    val hi = edges.getOrNull(tier + 1)
    val fromProgress = if (hi == null || rank == null) 1f else (((rank.before - lo) / (hi - lo)).coerceIn(0.0, 1.0)).toFloat()
    val toProgress = if (hi == null) 1f else (((settledRank - lo) / (hi - lo)).coerceIn(0.0, 1.0)).toFloat()
    val shownProgress by animateFloatAsState(
        targetValue = if (started || !counted) toProgress else fromProgress,
        animationSpec = tween(COUNT_MS, easing = FastOutSlowInEasing),
        label = "seasonRankProgress",
    )
    LaunchedEffect(settledRank) { if (counted) started = true }

    val content: @Composable ColumnScope.() -> Unit = {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                stringResource(if (counted) R.string.post_game_rank_updated_title else R.string.post_game_rank_standing_title).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp).testTag("season_rank_dismiss")) {
                Icon(Icons.Default.Close, dismissLabel, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        if (provisional) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    stringResource(R.string.season_rank_provisional),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.ExtraBold,
                )
                LinearProgressIndicator(
                    progress = { (gamesThisSeason.coerceAtMost(UNLOCK_TOTAL).toFloat() / UNLOCK_TOTAL) },
                    color = tierColor,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                )
                Text(
                    stringResource(R.string.post_game_rank_unlock, gamesThisSeason),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    jsNumber(shownRank.toDouble()),
                    fontSize = 32.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = tierColor,
                    modifier = Modifier.testTag("season_rank_value"),
                )
                if (counted && rank != null) {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = deltaColor.copy(alpha = 0.14f),
                        border = BorderStroke(1.dp, deltaColor.copy(alpha = 0.4f)),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            if (positive || negative) {
                                Icon(
                                    if (positive) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown,
                                    null,
                                    tint = deltaColor,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                            Text(
                                stringResource(R.string.post_game_rank_delta, deltaLabel),
                                color = deltaColor,
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.ExtraBold,
                            )
                        }
                    }
                }
                AssistChip(
                    onClick = {},
                    label = { Text(tierName, fontWeight = FontWeight.ExtraBold, color = tierColor) },
                )
            }

            if (counted && rank != null && rank.tierAfter > rank.tierBefore) {
                Text(
                    stringResource(R.string.post_game_rank_tier_up, tierName),
                    style = MaterialTheme.typography.labelMedium,
                    color = tierColor,
                    fontWeight = FontWeight.Bold,
                )
            }

            // Tier bar only means something while there is a tier ahead: at the
            // top tier it would sit at 100% forever, a meter that never moves.
            if (hi != null) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LinearProgressIndicator(
                        progress = { shownProgress },
                        color = tierColor,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).testTag("season_rank_progress"),
                    )
                    Text(
                        stringResource(
                            R.string.post_game_rank_to_next,
                            jsNumber(hi - settledRank),
                            RankTierNames.getOrElse(tier + 1) { "" },
                        ),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Text(
                    stringResource(R.string.season_rank_top_tier),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Neutral notice, not a warning: the checklist right below owns the
        // "add the score" button, so this row only explains the delay.
        if (!counted) {
            Text(
                stringResource(R.string.post_game_rank_cue),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("season_rank_cue").padding(vertical = 4.dp),
            )
        }

        crew?.let { c ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth().testTag("season_rank_crew"),
            ) {
                Icon(Icons.Default.Groups, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    stringResource(R.string.post_game_rank_crew_label),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AssistChip(
                    onClick = {},
                    label = { Text(c.name, fontWeight = FontWeight.Bold) },
                    modifier = Modifier.height(28.dp),
                )
                Text(
                    stringResource(R.string.post_game_rank_crew_place, c.place, c.placeCount) +
                        " · " +
                        stringResource(R.string.post_game_rank_crew_points, jsNumber(c.points)),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // Crews only ever earn points, so a payout chip means "up". Place
                // is already shown as "#n of m" and rarely moves on its own.
                val pointsDelta = c.pointsDelta
                if (pointsDelta != null && pointsDelta > 0) {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
                        modifier = Modifier.testTag("season_rank_crew_delta"),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.TrendingUp,
                                null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(14.dp),
                            )
                            Text(
                                stringResource(R.string.post_game_rank_crew_points_delta, jsNumber(pointsDelta)),
                                color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.ExtraBold,
                            )
                        }
                    }
                }
            }
        }

        // The two links read as one row: explainer first (counted only — a
        // standing has no movement to explain), season page after.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(top = 4.dp),
        ) {
            if (counted && rank != null) {
                TextButton(
                    onClick = onWhyClick,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    modifier = Modifier.semantics { contentDescription = whyAria },
                ) {
                    Icon(Icons.Outlined.Info, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.post_game_rank_why), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(
                onClick = onViewSeason,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier
                    .testTag("season_rank_season_link")
                    .semantics { contentDescription = viewSeasonAria },
            ) {
                Text(stringResource(R.string.post_game_rank_view_season), fontWeight = FontWeight.Bold)
            }
        }
    }

    if (inline) {
        Column(
            modifier = modifier.fillMaxWidth().testTag("season_rank_reveal").padding(vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    } else {
        Surface(
            modifier = modifier.fillMaxWidth().testTag("season_rank_reveal"),
            shape = RoundedCornerShape(12.dp),
            color = tierColor.copy(alpha = 0.08f),
            border = BorderStroke(1.dp, tierColor.copy(alpha = 0.3f)),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
        }
    }
}
