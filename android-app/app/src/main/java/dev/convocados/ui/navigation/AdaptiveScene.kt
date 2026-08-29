package dev.convocados.ui.navigation

import android.graphics.Rect
import dev.convocados.ui.theme.ConvocadosLayout

data class HingePaneWidths(
    val left: Int,
    val right: Int,
    val hinge: Int,
)

internal fun tabletopListPaneHeight(windowHeight: Int, hingeBounds: Rect): Int? =
    tabletopListPaneHeight(windowHeight, hingeBounds.top, hingeBounds.bottom)

internal fun tabletopListPaneHeight(windowHeight: Int, hingeTop: Int, hingeBottom: Int): Int? {
    if (windowHeight <= 0 || hingeTop <= 0 || hingeBottom <= hingeTop) return null
    val topPane = hingeTop.coerceAtMost(windowHeight)
    return topPane.takeIf { it > 0 && it < windowHeight }
}

/**
 * Converts the actual separating vertical hinge bounds into pane widths. The
 * hinge itself is never assigned to either content pane.
 */
internal fun hingePaneWidths(windowWidth: Int, hingeBounds: Rect): HingePaneWidths? =
    hingePaneWidths(windowWidth, hingeBounds.left, hingeBounds.right)

internal fun hingePaneWidths(windowWidth: Int, hingeLeft: Int, hingeRight: Int): HingePaneWidths? {
    if (windowWidth <= 0 || hingeLeft < 0 || hingeRight <= hingeLeft) return null
    val left = hingeLeft.coerceAtMost(windowWidth)
    val right = hingeRight.coerceIn(left, windowWidth)
    if (right <= left || windowWidth <= right) return null
    return HingePaneWidths(
        left = left,
        right = windowWidth - right,
        hinge = right - left,
    )
}

enum class EventSceneMode {
    FullScreen,
    ListOnly,
    ListDetail,
    DetailOnly,
}

/**
 * Chooses the relationship between the Games list and Event Detail. Compact
 * phone windows and Wear remain full-screen. A tabletop fold uses a single
 * detail pane because its horizontal hinge cannot safely host side-by-side
 * content; unfolded windows retain the list-detail relationship.
 */
fun eventSceneMode(
    layout: ConvocadosLayout,
    selectedEventId: String?,
    isTabletop: Boolean = false,
): EventSceneMode = when {
    layout == ConvocadosLayout.Compact -> EventSceneMode.FullScreen
    selectedEventId == null -> EventSceneMode.ListOnly
    isTabletop -> EventSceneMode.DetailOnly
    else -> EventSceneMode.ListDetail
}
