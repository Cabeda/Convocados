package dev.convocados.ui.navigation

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import dev.convocados.ui.screen.games.GamesScreen
import dev.convocados.ui.theme.ConvocadosLayout
import dev.convocados.ui.theme.layoutForWidthDp
import kotlinx.coroutines.flow.collect
import kotlin.math.roundToInt

/**
 * Adaptive Games shell. The screen owns only selection; route construction and
 * event-detail behavior remain with AppNavigation, keeping this seam reusable
 * and easy to test through [eventSceneMode].
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun AdaptiveGamesRoute(
    onCompactEventClick: (String) -> Unit,
    onCreateClick: () -> Unit,
    onPublicClick: () -> Unit,
    onOpenSettings: (String) -> Unit,
    initialSelectedEventId: String? = null,
    detailContent: @Composable (eventId: String, onClose: () -> Unit) -> Unit,
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    var selectedEventId by rememberSaveable { mutableStateOf<String?>(null) }
    var consumedInitialEventId by rememberSaveable { mutableStateOf<String?>(null) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val layout = layoutForWidthDp(maxWidth.value.toInt())
        val windowLayoutInfo = rememberWindowLayoutInfo()
        val isTabletop = currentWindowAdaptiveInfoV2().windowPosture.isTabletop
        val density = LocalDensity.current
        val windowWidthPx = with(density) { maxWidth.toPx().roundToInt() }
        val windowHeightPx = with(density) { maxHeight.toPx().roundToInt() }
        val verticalHinge = windowLayoutInfo.displayFeatures
            .filterIsInstance<FoldingFeature>()
            .firstOrNull { it.isSeparating && it.bounds.width() < it.bounds.height() }
        val horizontalHinge = windowLayoutInfo.displayFeatures
            .filterIsInstance<FoldingFeature>()
            .firstOrNull { it.isSeparating && it.bounds.height() < it.bounds.width() }
        val hingeWidths = verticalHinge?.let { hingePaneWidths(windowWidthPx, it.bounds) }
        val tabletopDetailModifier = if (isTabletop && horizontalHinge != null) {
            Modifier.padding(top = Dp(horizontalHinge.bounds.bottom / density.density))
        } else {
            Modifier
        }
        val tabletopListPaneHeight = horizontalHinge?.let {
            tabletopListPaneHeight(windowHeightPx, it.bounds)
        }
        val tabletopListModifier = tabletopListPaneHeight?.let {
            Modifier.height(Dp(it / density.density))
        } ?: Modifier
        LaunchedEffect(initialSelectedEventId, layout, isTabletop) {
            val initialId = initialSelectedEventId
            if (!shouldOpenInitialEvent(initialId, consumedInitialEventId)) return@LaunchedEffect
            consumedInitialEventId = initialId
            if (layout == ConvocadosLayout.Compact) {
                selectedEventId = null
                onCompactEventClick(initialId!!)
            } else {
                selectedEventId = initialId
            }
        }
        LaunchedEffect(layout, isTabletop) {
            if (layout == ConvocadosLayout.Compact) selectedEventId = null
        }
        val mode = eventSceneMode(layout, selectedEventId, isTabletop)
        BackHandler(enabled = mode == EventSceneMode.ListDetail || mode == EventSceneMode.DetailOnly) {
            selectedEventId = null
        }
        val onEventClick: (String) -> Unit = { eventId ->
            if (layout == ConvocadosLayout.Compact) onCompactEventClick(eventId)
            else selectedEventId = eventId
        }

        @Composable
        fun DetailPane(eventId: String) {
            detailContent(eventId) { selectedEventId = null }
        }

        when (mode) {
            EventSceneMode.FullScreen -> GamesScreen(
                onEventClick = onEventClick,
                onCreateClick = onCreateClick,
                onPublicClick = onPublicClick,
                onOpenSettings = onOpenSettings,
                sharedTransitionScope = sharedTransitionScope,
                animatedVisibilityScope = animatedVisibilityScope,
            )

            EventSceneMode.ListOnly -> Box(Modifier.fillMaxSize().then(tabletopListModifier)) {
                GamesScreen(
                    onEventClick = onEventClick,
                    onCreateClick = onCreateClick,
                    onPublicClick = onPublicClick,
                    onOpenSettings = onOpenSettings,
                    sharedTransitionScope = sharedTransitionScope,
                    animatedVisibilityScope = animatedVisibilityScope,
                )
            }

            EventSceneMode.DetailOnly -> selectedEventId?.let { eventId ->
                Box(Modifier.fillMaxSize().then(tabletopDetailModifier)) {
                    DetailPane(eventId)
                }
            }

            EventSceneMode.ListDetail -> Row(Modifier.fillMaxSize()) {
                if (hingeWidths == null) {
                    Box(Modifier.weight(0.45f)) {
                        GamesScreen(
                            onEventClick = onEventClick,
                            onCreateClick = onCreateClick,
                            onPublicClick = onPublicClick,
                            onOpenSettings = onOpenSettings,
                            sharedTransitionScope = sharedTransitionScope,
                            animatedVisibilityScope = animatedVisibilityScope,
                        )
                    }
                    VerticalDivider(thickness = 1.dp)
                    Box(Modifier.weight(0.55f)) {
                        selectedEventId?.let { eventId -> DetailPane(eventId) }
                    }
                } else {
                    Box(Modifier.width(Dp(hingeWidths.left / density.density))) {
                        GamesScreen(
                            onEventClick = onEventClick,
                            onCreateClick = onCreateClick,
                            onPublicClick = onPublicClick,
                            onOpenSettings = onOpenSettings,
                            sharedTransitionScope = sharedTransitionScope,
                            animatedVisibilityScope = animatedVisibilityScope,
                        )
                    }
                    Spacer(Modifier.width(Dp(hingeWidths.hinge / density.density)))
                    Box(Modifier.width(Dp(hingeWidths.right / density.density))) {
                        selectedEventId?.let { eventId -> DetailPane(eventId) }
                    }
                }
            }
        }
    }
}


@Composable
private fun rememberWindowLayoutInfo(): WindowLayoutInfo {
    val activity = LocalContext.current.findActivity()
    return produceState(WindowLayoutInfo(emptyList()), activity) {
        if (activity == null) return@produceState
        WindowInfoTracker.getOrCreate(activity)
            .windowLayoutInfo(activity)
            .collect { value = it }
    }.value
}

internal fun shouldOpenInitialEvent(initialEventId: String?, consumedEventId: String?): Boolean =
    initialEventId != null && initialEventId != consumedEventId

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
