package dev.convocados.wear.ui.fixture

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
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
import kotlin.math.hypot

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
 * 3. On square displays, content still uses the full width (no regression).
 * 4. Round and square goldens for the same screen actually differ — form-factor
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
        assertTeamTilesUseWidth(limg, minFraction = 0.85f, context = "round live score")
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

    // ── 4. Round and square goldens must actually differ ─────────────────
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
    private fun assertContentInsideCircle(image: ImageBitmap, context: String) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val cx = w / 2f
        val cy = h / 2f
        val radius = (minOf(w, h) / 2f) * 0.97f

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
                    if (distance > radius) {
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
    private fun assertTeamTilesUseWidth(
        image: ImageBitmap,
        minFraction: Float,
        context: String,
    ) {
        val pixels = image.toPixelMap()
        val w = pixels.width
        val h = pixels.height
        val teamOne = Color(0xFF33402F)
        val teamTwo = Color(0xFF4A3A2C)

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
