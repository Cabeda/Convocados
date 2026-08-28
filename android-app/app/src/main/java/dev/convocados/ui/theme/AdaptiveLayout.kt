package dev.convocados.ui.theme

/**
 * Layout buckets used by screen content independently of navigation technology.
 * Keeping this decision pure makes it easy to verify against phone, tablet, and
 * foldable screenshot qualifiers.
 */
enum class ConvocadosLayout {
    Compact,
    Medium,
    Expanded,
}

fun layoutForWidthDp(widthDp: Int): ConvocadosLayout = when {
    widthDp < 600 -> ConvocadosLayout.Compact
    widthDp < 840 -> ConvocadosLayout.Medium
    else -> ConvocadosLayout.Expanded
}

fun contentMaxWidthDp(layout: ConvocadosLayout): Int = when (layout) {
    ConvocadosLayout.Compact -> 600
    ConvocadosLayout.Medium -> 840
    ConvocadosLayout.Expanded -> 1200
}
