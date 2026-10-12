package dev.convocados.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import kotlin.math.abs

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

/**
 * The screen's own list. The composition also renders the reference row's list,
 * which the anchor tag excludes.
 */
fun screenList(): SemanticsMatcher = hasScrollAction().and(hasTestTag(ROUND_SAFE_ANCHOR_LIST_TAG).not())

/**
 * A blanket 20dp inset on both sides of a 390dp display would leave ~79%; a
 * correct square layout spans ~89%.
 */
const val MIN_SQUARE_FILL_FRACTION = 0.85f

/** The display width the rows have to fill on a square layout. */
fun displayWidth(rule: ComposeContentTestRule): Float =
    rule.onRoot().fetchSemanticsNode().size.width.toFloat()

/**
 * The band a round-safe row occupies, measured from the reference control.
 * Guarded on the reference really being inset from the list by the documented
 * [ROUND_LIST_INSET], otherwise comparing against it proves nothing.
 */
fun roundSafeBand(rule: ComposeContentTestRule): Rect {
    val band = rule.onNodeWithTag(ROUND_SAFE_ANCHOR_TAG).fetchSemanticsNode().boundsInRoot
    val list = rule.onNode(screenList()).fetchSemanticsNode().boundsInRoot
    val inset = with(rule.density) { ROUND_LIST_INSET.toPx() }
    val tolerance = 0.5f
    assertTrue(
        ("reference row is inset %.1fpx/%.1fpx from the list, expected at least %.1fpx on each side " +
            "— the reference is no longer round-safe")
            .format(band.left - list.left, list.right - band.right, inset - tolerance),
        band.left - list.left >= inset - tolerance && list.right - band.right >= inset - tolerance,
    )
    return band
}

/** Scrolls [matcher] into view on the screen's list and measures its bounds. */
fun boundsOf(rule: ComposeContentTestRule, label: String, matcher: SemanticsMatcher): Rect {
    rule.onNode(screenList()).performScrollToNode(matcher)
    rule.waitForIdle()
    return rule.onNode(matcher).fetchSemanticsNode(label).boundsInRoot
}

fun assertRowFillsBand(label: String, bounds: Rect, band: Rect) {
    val tolerance = 0.5f
    assertTrue(
        ("%s spans [%.1f, %.1f], expected the round-safe band [%.1f, %.1f] — the row is laid out " +
            "at the bezel-crossing width on a round display")
            .format(label, bounds.left, bounds.right, band.left, band.right),
        abs(bounds.left - band.left) <= tolerance && abs(bounds.right - band.right) <= tolerance,
    )
}

fun assertRowInsideBand(label: String, bounds: Rect, band: Rect) {
    val tolerance = 0.5f
    assertTrue(
        ("%s spans [%.1f, %.1f], expected inside the round-safe band [%.1f, %.1f] — the row " +
            "crosses the circular bezel")
            .format(label, bounds.left, bounds.right, band.left, band.right),
        bounds.left >= band.left - tolerance && bounds.right <= band.right + tolerance,
    )
}

/**
 * The inset is a no-op on square displays, so the rows must still fill the
 * display there — the fix must not shrink every form factor.
 */
fun assertFillsDisplay(label: String, bounds: Rect, displayWidth: Float) {
    val fraction = bounds.width / displayWidth
    assertTrue(
        ("%s spans %.1f%% of the display width, expected at least %.1f%% — the round-only inset " +
            "must not be applied on square displays")
            .format(label, fraction * 100, MIN_SQUARE_FILL_FRACTION * 100),
        fraction >= MIN_SQUARE_FILL_FRACTION,
    )
}

// ── line budget ────────────────────────────────────────────────────────

/**
 * How the label actually laid out. A clipped text still reports the whole
 * string in its semantics, so an ellipsis is only visible here.
 */
fun textLayout(rule: ComposeContentTestRule, label: String, matcher: SemanticsMatcher): TextLayoutResult {
    val node: SemanticsNode = boundsOfNode(rule, label, matcher)
    val results = mutableListOf<TextLayoutResult>()
    node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
    return results.firstOrNull()
        ?: throw AssertionError("$label carries no text layout, so its clipping cannot be measured")
}

private fun boundsOfNode(
    rule: ComposeContentTestRule,
    label: String,
    matcher: SemanticsMatcher,
): SemanticsNode {
    rule.onNode(screenList()).performScrollToNode(matcher)
    rule.waitForIdle()
    return rule.onNode(matcher).fetchSemanticsNode(label)
}

/**
 * The ellipsis is a round-only affordance: on a square display the row is full
 * width and the label must keep the default budget, wrapping as it did before
 * the inset fix.
 */
fun assertNotLineLimited(rule: ComposeContentTestRule, label: String, matcher: SemanticsMatcher) {
    val layout = textLayout(rule, label, matcher)
    assertEquals(
        "$label is limited to ${layout.layoutInput.maxLines} line(s) on a square display — " +
            "the round-only ellipsis clips text that used to wrap",
        Int.MAX_VALUE,
        layout.layoutInput.maxLines,
    )
    assertEquals(
        "$label clips on a square display",
        TextOverflow.Clip,
        layout.layoutInput.overflow,
    )
}

/** A long prompt really does get its second line on a square display. */
fun assertWraps(
    rule: ComposeContentTestRule,
    label: String,
    matcher: SemanticsMatcher,
    atLeastLines: Int,
) {
    val layout = textLayout(rule, label, matcher)
    assertTrue(
        ("%s laid out on %d line(s), expected at least %d — the text is clipped before it " +
            "can wrap")
            .format(label, layout.lineCount, atLeastLines),
        layout.lineCount >= atLeastLines,
    )
}

/** The round half of the same bargain: [roundLines] ellipsised lines at most. */
fun assertEllipsised(
    rule: ComposeContentTestRule,
    label: String,
    matcher: SemanticsMatcher,
    roundLines: Int,
) {
    val layout = textLayout(rule, label, matcher)
    assertEquals(
        "$label must be ellipsised on a round display",
        TextOverflow.Ellipsis,
        layout.layoutInput.overflow,
    )
    assertTrue(
        "$label is allowed ${layout.layoutInput.maxLines} line(s), expected at most $roundLines",
        layout.layoutInput.maxLines <= roundLines,
    )
}
