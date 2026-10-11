package dev.convocados.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold

/**
 * Test tag for the [RoundSafeReferenceRow] anchor itself, and for the list that
 * carries it. Internal: both exist so the wear tests can address them, and a
 * test source set is their only home — production must not export a tag just
 * to be assertable (GH #1276).
 */
internal const val ROUND_SAFE_ANCHOR_TAG = "round_safe_reference_row"
internal const val ROUND_SAFE_ANCHOR_LIST_TAG = "round_safe_reference_list"

/**
 * A control that uses the very affordance the wear screens use for their
 * round-safe rows — `Modifier.fillMaxWidth().roundListInset()` — laid out
 * inside the same bezel-clipped scaffold/list skeleton those screens use, so a
 * test can measure the horizontal band a round-safe row actually occupies on a
 * given display.
 *
 * Screens that already contain an inset row can compare against that row
 * instead. For screens without one, this reference keeps the expected band a
 * measured property of the layout rather than a hard-coded number.
 */
@Composable
internal fun RoundSafeReferenceRow() {
    val columnState = rememberTransformingLazyColumnState()
    Box(
        Modifier
            .fillMaxSize()
            .roundBezelClip(),
    ) {
        ScreenScaffold(scrollState = columnState) { contentPadding ->
            TransformingLazyColumn(
                state = columnState,
                contentPadding = contentPadding,
                modifier = Modifier.testTag(ROUND_SAFE_ANCHOR_LIST_TAG),
            ) {
                item {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .roundListInset()
                            .height(2.dp)
                            .testTag(ROUND_SAFE_ANCHOR_TAG),
                    )
                }
            }
        }
    }
}
