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
import androidx.compose.material.icons.outlined.Info
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
import dev.convocados.R
import dev.convocados.data.api.SeasonRankMovement
import dev.convocados.util.jsNumber

private const val COUNT_MS = 900
private const val UNLOCK_TOTAL = 3

/**
 * Compact, scannable reveal of the viewer's Season Rank movement for the
 * just-played Game. The Rank counts up from before -> after on first view
 * (unless [animate] is false), with the delta pill and progress bar settling
 * in behind it. Mirrors the web `SeasonRankReveal`. The full explainer is
 * delegated to [onWhyClick], dismissal to [onDismiss].
 */
@Composable
fun SeasonRankReveal(
    rank: SeasonRankMovement,
    onWhyClick: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    animate: Boolean = true,
) {
    if (!rank.counted) return
    val whyAria = stringResource(R.string.post_game_rank_why_aria)
    val tierName = RankTierNames.getOrElse(rank.tierAfter) { RankTierNames.first() }
    val tierColor = RankTierColors.getOrElse(rank.tierAfter) { RankTierColors.first() }
    val positive = rank.delta > 0
    val negative = rank.delta < 0
    val deltaColor = when {
        positive -> MaterialTheme.colorScheme.primary
        negative -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val deltaLabel = (if (positive) "+" else "") + jsNumber(rank.delta)

    // Count-up from before -> after on first view.
    var started by remember(rank.after) { mutableStateOf(!animate) }
    val shownRank by animateIntAsState(
        targetValue = if (started) rank.after.toInt() else rank.before.toInt(),
        animationSpec = tween(COUNT_MS, easing = FastOutSlowInEasing),
        label = "seasonRankValue",
    )
    val lo = rank.edges.getOrNull(rank.tierAfter) ?: 0.0
    val hi = rank.edges.getOrNull(rank.tierAfter + 1)
    val fromProgress = if (hi == null) 1f else (((rank.before - lo) / (hi - lo)).coerceIn(0.0, 1.0)).toFloat()
    val toProgress = if (hi == null) 1f else (((rank.after - lo) / (hi - lo)).coerceIn(0.0, 1.0)).toFloat()
    val shownProgress by animateFloatAsState(
        targetValue = if (started) toProgress else fromProgress,
        animationSpec = tween(COUNT_MS, easing = FastOutSlowInEasing),
        label = "seasonRankProgress",
    )
    LaunchedEffect(rank.after) { started = true }

    Surface(
        modifier = modifier.fillMaxWidth().testTag("season_rank_reveal"),
        shape = RoundedCornerShape(12.dp),
        color = tierColor.copy(alpha = 0.08f),
        border = BorderStroke(1.dp, tierColor.copy(alpha = 0.3f)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                stringResource(R.string.post_game_rank_title).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (rank.provisional) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        stringResource(R.string.season_rank_provisional),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    LinearProgressIndicator(
                        progress = { (rank.gamesThisSeason.coerceAtMost(UNLOCK_TOTAL).toFloat() / UNLOCK_TOTAL) },
                        color = tierColor,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    )
                    Text(
                        stringResource(R.string.post_game_rank_unlock, rank.gamesThisSeason),
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
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = tierColor,
                        modifier = Modifier.testTag("season_rank_value"),
                    )
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
                    AssistChip(
                        onClick = {},
                        label = { Text(tierName, fontWeight = FontWeight.ExtraBold, color = tierColor) },
                    )
                }

                if (rank.tierAfter > rank.tierBefore) {
                    Text(
                        stringResource(R.string.post_game_rank_tier_up, tierName),
                        style = MaterialTheme.typography.labelMedium,
                        color = tierColor,
                        fontWeight = FontWeight.Bold,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LinearProgressIndicator(
                        progress = { shownProgress },
                        color = tierColor,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    )
                    Text(
                        if (hi != null) {
                            stringResource(
                                R.string.post_game_rank_to_next,
                                jsNumber(hi - rank.after),
                                RankTierNames.getOrElse(rank.tierAfter + 1) { "" },
                            )
                        } else {
                            stringResource(R.string.season_rank_top_tier)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss, modifier = Modifier.testTag("season_rank_dismiss")) {
                    Text(stringResource(R.string.post_game_rank_dismiss), fontWeight = FontWeight.SemiBold)
                }
                TextButton(onClick = onWhyClick, modifier = Modifier.semantics { contentDescription = whyAria }) {
                    Icon(Icons.Outlined.Info, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.post_game_rank_why), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
