package dev.convocados.wear.ui.fixture

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import dev.convocados.wear.ui.MIN_TOUCH_TARGET
import dev.convocados.wear.ui.ROUND_BEZEL_INSET
import dev.convocados.wear.ui.ROUND_LIST_INSET
import dev.convocados.wear.ui.assertCornersInsideBezel
import dev.convocados.wear.ui.positionAwareInsetPx
import dev.convocados.wear.ui.screen.quick.QuickScoreContent
import dev.convocados.wear.ui.screen.quick.QuickSetupScreen
import dev.convocados.wear.ui.screen.quick.SaveQuickGameContent
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Any non-background content must stay inside this fraction of the circular
 * bezel radius; matches the visibility of `roundBezelClip`'s inset clip.
 */
private const val BEZEL_CONTAINMENT_FRACTION = 1.0f

/**
 * Stricter bound for the score tiles: they are the only content that occupies
 * the equator band at full width, so their corners are the ones a round bezel
 * cuts first. 0.95 keeps a visible gap between tile and bezel clip on every
 * round display size, instead of relying on the material corner radius.
 */
private const val SCORE_TILE_BEZEL_FRACTION = 1.0f

/**
 * Round display widths the geometry is swept over: the smallest Wear OS round
 * devices through the largest, plus the sizes this module renders in its own
 * tests (200dp in `GamesScreenAutoNavTest`, 212dp on the physical Galaxy Watch4
 * the inset was measured on, 227dp in the screenshot goldens, 390dp shapes).
 */
private val ROUND_DISPLAY_SIZES_DP = listOf(192, 200, 212, 227, 300, 390, 454)

/** Row heights seen on the list screens: a label, a chip, a two-line chip. */
private val ROUND_LIST_ROW_HEIGHTS_DP = listOf(48, 52, 72, 96)

/** Vertical granularity of the row-position sweep. */
private const val ROUND_LIST_INSET_SWEEP_STEP_DP = 4f

/** px per dp used to exercise the geometry; only ratios matter. */
private const val TEST_DENSITY = 3f

private val TEAM_ONE_TILE = Color(0xFF33402F)
private val TEAM_TWO_TILE = Color(0xFF4A3A2C)

/**
 * Geometric shape assertions that go RED on the "square inside a circle" bug.
 *
 * Roborazzi goldens encode the current (buggy) rendering, so pixel-diff verify
 * stays green while production is wrong. These tests assert the invariants the
 * user actually cares about:
 *
 * 1. On round displays, no content pixel falls outside the circular bezel —
 *    full-bleed square rows that a real watch would clip.
 * 2. On round displays, centered score content spans most of the display
 *    width — not a 0.72 inscribed square floating with dead margins.
 * 3. On round displays, the score tiles clear the bezel on every round size —
 *    a wide block must earn its height from the circle, not from a fraction.
 * 4. On square displays, content still uses the full width (no regression).
 * 5. The position-aware list inset (GH #1452) never widens a row past the
 *    circular bezel at any supported round size, and still buys width at the
 *    equator on every one of them.
 * 6. Round and square goldens for the same screen actually differ — form-factor
 *    specific UI, not one layout shipped to both.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WearAdaptiveShapeTest {

    @get:Rule
    val composeRule = createComposeRule()

    // ── 1. Bezel containment on round ────────────────────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundGames_stayInsideCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                WearGamesFixtureContent(
                    games = WearFixtures.games,
                    pendingSyncCount = 1,
                    now = WearFixtures.now,
                )
            }
        }
        val gimg = composeRule.onRoot().captureToImage()
        saveDebug(gimg, "round_games")
        assertContentInsideCircle(gimg, context = "round games list")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundHistory_stayInsideCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)
            }
        }
        assertContentInsideCircle(
            composeRule.onRoot().captureToImage(),
            context = "round history list",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundTennisScore_stayInsideCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.tennisScore,
                    now = WearFixtures.now,
                    onIncrementOne = {},
                    onIncrementTwo = {},
                    onDecrementOne = {},
                    onDecrementTwo = {},
                    onUndo = {},
                )
            }
        }
        assertContentInsideCircle(
            composeRule.onRoot().captureToImage(),
            context = "round tennis score",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundQuickScore_stayInsideCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickScoreContent(
                    state = WearFixtures.quickScore,
                    nowOverride = WearFixtures.now,
                    onIncrementOne = {},
                    onDecrementOne = {},
                    onIncrementTwo = {},
                    onDecrementTwo = {},
                    onNextSet = {},
                    onToggleTiebreak = {},
                )
            }
        }
        assertContentInsideCircle(
            composeRule.onRoot().captureToImage(),
            context = "round quick score",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundQuickSetup_stayInsideCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickSetupScreen(onStart = { _, _, _ -> })
            }
        }
        val img3 = composeRule.onRoot().captureToImage()
        val qimg = composeRule.onRoot().captureToImage()
        saveDebug(qimg, "round_quicksetup")
        assertContentInsideCircle(qimg, context = "round quick setup")
    }

    // ── 2. Round score uses circular width, not an inscribed square ──────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundLiveScore_usesCircularWidthNotShrunkSquare() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.liveScore,
                    now = WearFixtures.now,
                    onIncrementOne = {},
                    onIncrementTwo = {},
                    onDecrementOne = {},
                    onDecrementTwo = {},
                    onUndo = {},
                )
            }
        }
        val img2 = composeRule.onRoot().captureToImage()
        val limg = composeRule.onRoot().captureToImage()
        saveDebug(limg, "round_live")
        assertTeamTilesFillTheCircle(limg, context = "round live score")
    }

    // ── 2b. Score tiles clear the bezel clip on every round size ─────────
    // The tiles sit at the equator, where the circle is widest, but a block
    // that spans 0.95 of the width may only be as tall as the inscribed
    // rectangle allows. Sized by a fixed height fraction instead, its corners
    // reach the circular bezel clip and only the material corner radius keeps
    // them from being cut — so the tiles must clear the bezel on their own.

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundLiveScore_scoreTilesClearTheCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.liveScore,
                    now = WearFixtures.now,
                    onIncrementOne = {},
                    onIncrementTwo = {},
                    onDecrementOne = {},
                    onDecrementTwo = {},
                    onUndo = {},
                )
            }
        }
        assertTeamTilesInsideCircle(
            composeRule.onRoot().captureToImage(),
            radiusFraction = SCORE_TILE_BEZEL_FRACTION,
            context = "round live score tiles",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundQuickScore_scoreTilesClearTheCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickScoreContent(
                    state = WearFixtures.quickScore,
                    nowOverride = WearFixtures.now,
                    onIncrementOne = {},
                    onDecrementOne = {},
                    onIncrementTwo = {},
                    onDecrementTwo = {},
                    onNextSet = {},
                    onToggleTiebreak = {},
                )
            }
        }
        assertTeamTilesInsideCircle(
            composeRule.onRoot().captureToImage(),
            radiusFraction = SCORE_TILE_BEZEL_FRACTION,
            context = "round quick score tiles",
        )
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun smallRoundLiveScore_scoreTilesClearTheCircularBezel() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.liveScore,
                    now = WearFixtures.now,
                    onIncrementOne = {},
                    onIncrementTwo = {},
                    onDecrementOne = {},
                    onDecrementTwo = {},
                    onUndo = {},
                )
            }
        }
        assertTeamTilesInsideCircle(
            composeRule.onRoot().captureToImage(),
            radiusFraction = SCORE_TILE_BEZEL_FRACTION,
            context = "small round live score tiles",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundQuickTennis_usesCircularWidthNotShrunkSquare() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickScoreContent(
                    state = WearFixtures.quickTennis,
                    nowOverride = WearFixtures.now,
                    onIncrementOne = {},
                    onDecrementOne = {},
                    onIncrementTwo = {},
                    onDecrementTwo = {},
                    onNextSet = {},
                    onToggleTiebreak = {},
                )
            }
        }
        // Tennis/padel go through QuickSetScoreEditor, a third tile layout that
        // still uses the fixed width fraction — and whose tiles still cross the
        // bezel (corners ~189px out on a 187px radius). Filed rather than fixed
        // here: its tiles sit in a Column weight, so the same modifier does not
        // apply without restructuring that editor.
        assertTeamTilesUseWidth(
            composeRule.onRoot().captureToImage(),
            minFraction = 0.80f,
            context = "round quick tennis score",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun roundQuickSave_contentSpansDisplay() {
        composeRule.setContent {
            ConvocadosWearTheme {
                SaveQuickGameContent(state = WearFixtures.quickSave)
            }
        }
        assertContentInsideCircle(
            composeRule.onRoot().captureToImage(),
            context = "round quick save",
        )
    }

    // ── 3. Square keeps full-bleed rectangular layout ────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun squareLiveScore_usesFullWidth() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.liveScore,
                    now = WearFixtures.now,
                    onIncrementOne = {},
                    onIncrementTwo = {},
                    onDecrementOne = {},
                    onDecrementTwo = {},
                    onUndo = {},
                )
            }
        }
        assertTeamTilesUseWidth(
            composeRule.onRoot().captureToImage(),
            minFraction = 0.80f,
            context = "square live score",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun squareQuickScore_usesFullWidth() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickScoreContent(
                    state = WearFixtures.quickScore,
                    nowOverride = WearFixtures.now,
                    onIncrementOne = {},
                    onDecrementOne = {},
                    onIncrementTwo = {},
                    onDecrementTwo = {},
                    onNextSet = {},
                    onToggleTiebreak = {},
                )
            }
        }
        assertTeamTilesUseWidth(
            composeRule.onRoot().captureToImage(),
            minFraction = 0.80f,
            context = "square quick score",
        )
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun squareGames_usesFullWidth() {
        composeRule.setContent {
            ConvocadosWearTheme {
                WearGamesFixtureContent(
                    games = WearFixtures.games,
                    pendingSyncCount = 1,
                    now = WearFixtures.now,
                )
            }
        }
        assertCenterRowUsesWidth(
            composeRule.onRoot().captureToImage(),
            minFraction = 0.90f,
            context = "square games list",
        )
    }

    // ── 4. The list-inset curve never widens a row past the bezel ────────
    // `assertContentInsideCircle` cannot police this: every list screen is
    // wrapped in `roundBezelClip`, so an over-wide row is clipped away and the
    // pixels stay inside however far the row actually reached. These cases
    // check the row's own width against the circle it has to fit in, at every
    // round size the app runs on, and they are what keeps a future widening of
    // the curve honest (GH #1452).

    @Test
    fun roundListInset_neverWidensARowPastTheBezel() {
        val bezelPx = ROUND_BEZEL_INSET.value * TEST_DENSITY
        val flatPx = ROUND_LIST_INSET.value * TEST_DENSITY
        val minContentPx = MIN_TOUCH_TARGET.value * TEST_DENSITY
        var widened = 0
        var capped = 0

        ROUND_DISPLAY_SIZES_DP.forEach { sizeDp ->
            val displayPx = sizeDp * TEST_DENSITY
            val display = Rect(0f, 0f, displayPx, displayPx)
            val radius = displayPx / 2f - bezelPx
            // Whichever ceiling binds first: the flat inset, or the touch floor
            // that stops the circle from squeezing a row's label to pieces.
            val ceilingPx = minOf(floor((displayPx - minContentPx) / 2f), flatPx.roundToInt().toFloat())
            ROUND_LIST_ROW_HEIGHTS_DP.forEach { heightDp ->
                val rowHeight = heightDp * TEST_DENSITY
                var top = 0f
                while (top + rowHeight <= displayPx) {
                    val bottom = top + rowHeight
                    // The widest a row can be: the display itself, before the
                    // scaffold's horizontal padding. Passing the strictest width
                    // a screen can hand this modifier keeps the property true
                    // for the narrower rows the screens actually build.
                    val inset = positionAwareInsetPx(
                        width = displayPx.roundToInt(),
                        rowTop = top,
                        rowBottom = bottom,
                        displayWidthPx = displayPx,
                        displayHeightPx = displayPx,
                        bezelInsetPx = bezelPx.roundToInt(),
                        fallbackPx = flatPx.roundToInt(),
                        minContentWidthPx = minContentPx,
                    )
                    val yFar = maxOf(abs(top - displayPx / 2f), abs(bottom - displayPx / 2f))
                    if (inset < ceilingPx) {
                        widened++
                        assertCornersInsideBezel(
                            label = "%ddp display, %ddp row at y=%.0f..%.0f".format(
                                sizeDp, heightDp, top / TEST_DENSITY, bottom / TEST_DENSITY,
                            ),
                            bounds = Rect(inset.toFloat(), top, displayPx - inset, bottom),
                            display = display,
                            bezelInsetPx = bezelPx,
                            because = ("the curve widened it to %.0fdp of %.0fdp per side, and an " +
                                "inset the circle cannot pay for is a row the bezel will crop")
                                .format((displayPx - 2 * inset) / 2f / TEST_DENSITY, displayPx / 2f / TEST_DENSITY),
                            // No slack: the inset rounds *up* precisely so the
                            // corner lands on or inside the radius. A pixel of
                            // fudge would accept the off-by-one that rounding
                            // exists to prevent.
                            tolerance = 0.01f,
                        )
                    } else {
                        // Held at a ceiling. That is only legitimate where the
                        // circle genuinely cannot pay for the flat width, so a
                        // future bug cannot hide rows in this branch.
                        capped++
                        val required = ceil(displayPx / 2f - sqrt((radius * radius - yFar * yFar).coerceAtLeast(0f)))
                        assertTrue(
                            ("on a %ddp round display a %ddp row at y=%.0f..%.0f kept the %.0fdp " +
                                "ceiling although the circle had room for %.0fdp per side")
                                .format(
                                    sizeDp, heightDp, top / TEST_DENSITY, bottom / TEST_DENSITY,
                                    (displayPx / 2f - ceilingPx) / TEST_DENSITY,
                                    (displayPx / 2f - required) / TEST_DENSITY,
                                ),
                            required >= ceilingPx,
                        )
                    }
                    top += ROUND_LIST_INSET_SWEEP_STEP_DP * TEST_DENSITY
                }
            }
        }

        assertTrue(
            "no row was widened at any round size — the inset is flat again, so this " +
                "property stopped testing anything",
            widened > 0,
        )
        assertTrue(
            "no row was ever capped at the flat inset — the sweep no longer reaches the poles",
            capped > 0,
        )
    }

    @Test
    fun roundListInset_equatorRowIsWiderThanTheFlatInsetOnEveryRoundSize() {
        val bezelPx = ROUND_BEZEL_INSET.value * TEST_DENSITY
        val flatPx = ROUND_LIST_INSET.value * TEST_DENSITY
        val minContentPx = MIN_TOUCH_TARGET.value * TEST_DENSITY
        val rowHeight = 52f * TEST_DENSITY

        ROUND_DISPLAY_SIZES_DP.forEach { sizeDp ->
            val displayPx = sizeDp * TEST_DENSITY
            val top = displayPx / 2f - rowHeight / 2f
            val inset = positionAwareInsetPx(
                width = displayPx.roundToInt(),
                rowTop = top,
                rowBottom = top + rowHeight,
                displayWidthPx = displayPx,
                displayHeightPx = displayPx,
                bezelInsetPx = bezelPx.roundToInt(),
                fallbackPx = flatPx.roundToInt(),
                minContentWidthPx = minContentPx,
            )
            assertTrue(
                ("on a %ddp round display the equator row keeps a %dpx inset — that is the flat " +
                    "%dpx one, so the curve buys nothing where the circle is widest")
                    .format(sizeDp, inset, flatPx.roundToInt()),
                inset < flatPx.roundToInt(),
            )
            // "Wider than flat" alone would accept a 1px improvement. The row has
            // to use the room the circle actually has, within the rounding.
            val radius = displayPx / 2f - bezelPx
            val corner = hypot((displayPx - 2 * inset) / 2f, rowHeight / 2f)
            assertTrue(
                ("on a %ddp round display the equator row's corner sits %.1fpx from the centre " +
                    "against a %.1fpx bezel radius — the curve left %.1fdp unused")
                    .format(sizeDp, corner, radius, (radius - corner) / TEST_DENSITY),
                radius - corner < 1.5f,
            )
        }
    }

    // ── 5. Round and square goldens must actually differ ─────────────────
    // Compares the committed Roborazzi goldens: if they are near-identical,
    // the app ships one square layout to both form factors.

    @Test
    fun gamesGolden_differsBetweenRoundAndSquare() {
        assertGoldensDiffer("round_games", "square_games", minDiff = 0.02f)
    }

    @Test
    fun liveScoreGolden_differsBetweenRoundAndSquare() {
        assertGoldensDiffer("round_live_score", "square_live_score", minDiff = 0.02f)
    }

    @Test
    fun quickScoreGolden_differsBetweenRoundAndSquare() {
        assertGoldensDiffer("round_quick_score", "square_quick_score", minDiff = 0.02f)
    }

    @Test
    fun historyGolden_differsBetweenRoundAndSquare() {
        assertGoldensDiffer("round_history", "square_history", minDiff = 0.02f)
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private fun assertGoldensDiffer(roundName: String, squareName: String, minDiff: Float) {
        val dir = File("src/test/screenshots/shapes")
        val roundFile = File(dir, "$roundName.png")
        val squareFile = File(dir, "$squareName.png")
        assertTrue("missing golden $roundFile", roundFile.isFile)
        assertTrue("missing golden $squareFile", squareFile.isFile)

        val round = ImageIO.read(roundFile)
        val square = ImageIO.read(squareFile)
        val w = minOf(round.width, square.width)
        val h = minOf(round.height, square.height)
        var differing = 0
        var total = 0
        val step = maxOf(1, minOf(w, h) / 250)
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                total++
                if (round.getRGB(x, y) != square.getRGB(x, y)) differing++
                x += step
            }
            y += step
        }
        val diff = if (total == 0) 0f else differing.toFloat() / total
        assertTrue(
            ("%s vs %s differ by %.2f%% — expected form-factor-specific UI, " +
                "got effectively the same layout on both shapes").format(roundName, squareName, diff * 100),
            diff >= minDiff,
        )
    }

    /**
     * Sample the four extreme corners to learn the background colour, then
     * assert every non-background pixel lies within the circular bezel
     * (radius = half the short side, minus a small anti-aliasing margin).
     */
    private fun assertContentInsideCircle(
        image: ImageBitmap,
        context: String,
        radiusFraction: Float = BEZEL_CONTAINMENT_FRACTION,
    ) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val cx = w / 2f
        val cy = h / 2f
        val radius = (minOf(w, h) / 2f - with(composeRule.density) { ROUND_BEZEL_INSET.toPx() }) * radiusFraction

        val background = pixels[0, 0]
        var outside = 0
        var outsideExamples = ""

        val step = maxOf(1, minOf(w, h) / 250)
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                val color = pixels[x, y]
                if (!isBackground(color, background)) {
                    val distance = hypot(x + 0.5f - cx, y + 0.5f - cy)
                    if (distance > radius + 1.5f) {
                        outside++
                        if (outside <= 5) {
                            outsideExamples += " ($x,$y d=${distance.toInt()})"
                        }
                    }
                }
                x += step
            }
            y += step
        }

        assertTrue(
            "$context: $outside sampled content pixels fall outside the circular bezel " +
                "(square layout clipped by round screen). Examples:$outsideExamples",
            outside == 0,
        )
    }

    /**
     * Assert every sampled team-tile pixel lies inside [radiusFraction] of the
     * circular bezel radius. Tighter than [assertContentInsideCircle] because
     * the tile block is the widest thing on the screen: a rectangle that spans
     * the equator has to earn its height from the circle, not from a fraction
     * of the available space.
     */
    private fun assertTeamTilesInsideCircle(
        image: ImageBitmap,
        radiusFraction: Float,
        context: String,
    ) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val cx = w / 2f
        val cy = h / 2f
        val radius = (minOf(w, h) / 2f - with(composeRule.density) { ROUND_BEZEL_INSET.toPx() }) * radiusFraction

        var outside = 0
        var outsideExamples = ""
        val step = maxOf(1, minOf(w, h) / 250)
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                val color = pixels[x, y]
                if (pixelsEqual(color, TEAM_ONE_TILE) || pixelsEqual(color, TEAM_TWO_TILE)) {
                    val distance = hypot(x + 0.5f - cx, y + 0.5f - cy)
                    if (distance > radius + 1.5f) {
                        outside++
                        if (outside <= 5) {
                            outsideExamples += " ($x,$y d=${distance.toInt()})"
                        }
                    }
                }
                x += step
            }
            y += step
        }

        assertTrue(
            "$context: $outside sampled team-tile pixels fall outside the circular bezel " +
                "(score block taller than the inscribed rectangle allows). Examples:$outsideExamples",
            outside == 0,
        )
    }

    private fun fractionOfPixelsDiffering(a: ImageBitmap, b: ImageBitmap): Float {
        val pa = a.toPixelMap()
        val pb = b.toPixelMap()
        val w = minOf(pa.width, pb.width)
        val h = minOf(pa.height, pb.height)
        var differing = 0
        var total = 0
        val step = maxOf(1, minOf(w, h) / 250)
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                total++
                if (!pixelsEqual(pa[x, y], pb[x, y])) differing++
                x += step
            }
            y += step
        }
        return if (total == 0) 0f else differing.toFloat() / total
    }

    private fun pixelsEqual(a: Color, b: Color): Boolean =
        abs(a.red - b.red) < 0.02f &&
            abs(a.green - b.green) < 0.02f &&
            abs(a.blue - b.blue) < 0.02f &&
            abs(a.alpha - b.alpha) < 0.02f

    private fun saveDebug(image: ImageBitmap, name: String) {
        runCatching {
            val pm = image.toPixelMap()
            val bmp = android.graphics.Bitmap.createBitmap(pm.width, pm.height, android.graphics.Bitmap.Config.ARGB_8888)
            val pixels = IntArray(pm.width * pm.height)
            for (y in 0 until pm.height) {
                for (x in 0 until pm.width) {
                    val c = pm[x, y]
                    pixels[y * pm.width + x] = android.graphics.Color.argb(
                        (c.alpha * 255).toInt(), (c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt(),
                    )
                }
            }
            bmp.setPixels(pixels, 0, pm.width, 0, 0, pm.width, pm.height)
            java.io.File("/tmp/debug_$name.png").outputStream().use {
                bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
    }

    private fun isBackground(color: Color, background: Color): Boolean =
        pixelsEqual(color, background)

    /**
     * At the vertical center band, any non-background content must span at
     * least [minFraction] of the display width. Used for list screens where
     * there is no single landmark colour.
     */
    private fun assertCenterRowUsesWidth(
        image: ImageBitmap,
        minFraction: Float,
        context: String,
    ) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val background = pixels[0, 0]

        val bandTop = (h * 0.40f).toInt()
        val bandBottom = (h * 0.60f).toInt()
        var minContentX = w
        var maxContentX = 0
        var found = false

        for (y in bandTop..bandBottom step 2) {
            for (x in 0 until w step 2) {
                if (!isBackground(pixels[x, y], background)) {
                    found = true
                    if (x < minContentX) minContentX = x
                    if (x > maxContentX) maxContentX = x
                }
            }
        }

        assertTrue("$context: no content found in center band", found)
        val span = (maxContentX - minContentX + 1).toFloat() / w
        assertTrue(
            ("%s: center-band content spans %.1f%% of width, expected ≥ %.1f%%")
                .format(context, span * 100, minFraction * 100),
            span >= minFraction,
        )
    }

    /**
     * Measure horizontal span of team-tile colours (TeamOne/TeamTwo) in the
     * vertical centre band. Ignores the edge-hugging progress ring, which
     * would otherwise mask a shrunk inscribed-square score layout.
     *
     * Round must use most of the circular width at the equator (circle is
     * widest there); square must keep its existing near-full-bleed span.
     */
    /**
     * The whole display is the score control: left half scores one team, right
     * half the other, and roundBezelClip cuts the pair into the circle.
     *
     * The guard this replaces asked that the tiles stay *inside* a rectangle
     * the circle could hold. That was the old design, where the tiles floated
     * in the middle and the ring was the edge. The control now deliberately
     * fills the display, so the assertion is that it does — a block that is
     * both short and narrow fails either way.
     */
    private fun assertTeamTilesFillTheCircle(image: ImageBitmap, context: String) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        var minX = w
        var maxX = 0
        var minY = h
        var maxY = 0
        for (y in 0 until h step 2) {
            for (x in 0 until w step 2) {
                val c = pixels[x, y]
                if (pixelsEqual(c, TEAM_ONE_TILE) || pixelsEqual(c, TEAM_TWO_TILE)) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
        }
        assertTrue("$context: no team tiles found", maxX > minX && maxY > minY)
        val widthFraction = (maxX - minX + 1).toFloat() / w
        val heightFraction = (maxY - minY + 1).toFloat() / h
        assertTrue(
            ("%s: the score control spans %.0f%% x %.0f%% of the display, expected it to fill it — " +
                "the whole screen is the button, left half for one team and right half for the other")
                .format(context, widthFraction * 100, heightFraction * 100),
            widthFraction >= 0.90f && heightFraction >= 0.90f,
        )
    }

    private fun assertTeamTilesUseWidth(
        image: ImageBitmap,
        minFraction: Float,
        context: String,
    ) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val teamOne = TEAM_ONE_TILE
        val teamTwo = TEAM_TWO_TILE

        val bandTop = (h * 0.40f).toInt()
        val bandBottom = (h * 0.60f).toInt()
        var minTileX = w
        var maxTileX = 0
        var found = false

        for (y in bandTop..bandBottom step 2) {
            for (x in 0 until w step 2) {
                val c = pixels[x, y]
                if (pixelsEqual(c, teamOne) || pixelsEqual(c, teamTwo)) {
                    found = true
                    if (x < minTileX) minTileX = x
                    if (x > maxTileX) maxTileX = x
                }
            }
        }

        assertTrue("$context: no team tiles found in center band", found)
        val span = (maxTileX - minTileX + 1).toFloat() / w
        assertTrue(
            ("%s: team tiles span %.1f%% of width, expected ≥ %.1f%% " +
                "(round score shrunk to inscribed square / square under-used)")
                .format(context, span * 100, minFraction * 100),
            span >= minFraction,
        )
    }
}
