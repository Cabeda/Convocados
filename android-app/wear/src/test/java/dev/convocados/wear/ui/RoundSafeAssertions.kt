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
import kotlin.math.hypot

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
                            .fillMaxWidth()
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
 * The width a row gets when the circle has no room to spare, measured from the
 * reference row rendered at the top of its own list — where the position-aware
 * inset is clamped by the flat [ROUND_LIST_INSET] ceiling. A screen's rows are
 * compared against this rather than against each other: rows no longer share
 * one band, but they must never come out *narrower* than the flat inset made
 * them, and any row wider than it is one the circle actually had room for.
 */
fun roundCeilingWidth(rule: ComposeContentTestRule): Float =
    rule.onNodeWithTag(ROUND_SAFE_ANCHOR_TAG).fetchSemanticsNode().boundsInRoot.width

/**
 * The invariant that replaced "every round-safe row shares one band".
 *
 * `roundListInset` used to be the flat [ROUND_LIST_INSET] at every scroll
 * position, so a screen could be checked by measuring its one round-safe row
 * and requiring every other row to span that same horizontal band. The inset is
 * now derived from where the row sits on the circle — wide at the equator,
 * capped at the old flat value near a pole — so there is no single band left
 * to share.
 *
 * What the band was a proxy for is asserted directly: **a row that is wider
 * than the flat inset would have made it only exists because the circle had
 * room, so its corners must be inside the bezel.** A row at the flat width is
 * carrying today's layout, bezel clip included, and has nothing to prove — the
 * defect GH #1276 and GH #992 were about was a row laid out *wider* than the
 * inset allowed, and that is what this catches.
 */
fun assertRowInsideBezel(rule: ComposeContentTestRule, label: String, bounds: Rect) {
    val ceiling = roundCeilingWidth(rule)
    val tolerance = 1f
    if (bounds.width <= ceiling + tolerance) return

    val display = rule.onRoot().fetchSemanticsNode().boundsInRoot
    val radius = (minOf(display.width, display.height) / 2f) - with(rule.density) { ROUND_BEZEL_INSET.toPx() }
    listOf(
        bounds.left to bounds.top,
        bounds.right to bounds.top,
        bounds.left to bounds.bottom,
        bounds.right to bounds.bottom,
    ).forEach { (x, y) ->
        val distance = hypot(x - display.center.x, y - display.center.y)
        assertTrue(
            ("%s spans %.1fpx, wider than the %.1fpx the flat inset allows, and its corner at " +
                "(%.1f, %.1f) sits %.1fpx from the centre — outside the %.1fpx bezel radius, so the " +
                "position-aware inset widened a row the circle had no room for")
                .format(label, bounds.width, ceiling, x, y, distance, radius),
            distance <= radius + 1.5f,
        )
    }
}

/** Scrolls [matcher] into view on the screen's list and measures its bounds. */
fun boundsOf(rule: ComposeContentTestRule, label: String, matcher: SemanticsMatcher): Rect {
    rule.onNode(screenList()).performScrollToNode(matcher)
    rule.waitForIdle()
    return rule.onNode(matcher).fetchSemanticsNode(label).boundsInRoot
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
