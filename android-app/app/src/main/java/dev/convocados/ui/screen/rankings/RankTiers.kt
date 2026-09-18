package dev.convocados.ui.screen.rankings

import androidx.compose.ui.graphics.Color

/** Tier display names, index-aligned with the web `TIER_NAMES`. */
val RankTierNames = listOf("Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master")

/** Tier presentation colours, index-aligned with [RankTierNames]. */
val RankTierColors = listOf(
    Color(0xFF8C6A4A), Color(0xFF8892A0), Color(0xFFC9A227),
    Color(0xFF3FA8A0), Color(0xFF5B8DEF), Color(0xFF9B6BFF),
)
