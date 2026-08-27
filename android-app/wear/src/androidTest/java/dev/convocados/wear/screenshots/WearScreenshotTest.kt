package dev.convocados.wear.screenshots

import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Automated screenshot generator for Wear OS app.
 *
 * Run:
 *   cd android-app
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.screenshots.WearScreenshotTest
 *
 * Screenshots are saved to app-private external files Pictures/wear-screenshots on the device.
 * Also falls back to /sdcard/Pictures/wear-screenshots for legacy pulls.
 * Pull them with:
 *   adb pull /sdcard/Android/data/com.cabeda.Convocados/files/Pictures/wear-screenshots ./docs/screenshots/wear/
 *   # or legacy path:
 *   adb pull /sdcard/Pictures/wear-screenshots/ docs/screenshots/wear/
 */
@RunWith(AndroidJUnit4::class)
class WearScreenshotTest {

    private val PACKAGE = "com.cabeda.Convocados"
    private val ACTIVITY = "dev.convocados.wear.ui.WearActivity"
    private val TIMEOUT = 10_000L

    private lateinit var device: UiDevice
    private lateinit var outputDir: File

    @Before
    fun setup() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.wakeUp()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // Prefer app-private external dir (always writable, no permission needed)
        val privateDir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        outputDir = if (privateDir != null) {
            File(privateDir, "wear-screenshots").apply { mkdirs() }
        } else {
            // Fallback to public Pictures (deprecated but may exist on emulator)
            File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "wear-screenshots"
            ).apply { mkdirs() }
        }
        // Also ensure legacy public dir exists for adb pull compatibility
        try {
            File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "wear-screenshots"
            ).mkdirs()
        } catch (_: Exception) {}
    }

    @Test
    fun captureAuthScreen() {
        // Try to clear app data to ensure auth screen shows, but don't fail if it doesn't
        try {
            device.executeShellCommand("pm clear $PACKAGE")
            Thread.sleep(2500)
        } catch (_: Exception) {
            // pm clear may fail on non-rooted or ephemeral emulator — best-effort only
            Thread.sleep(1000)
        }

        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        // Wait for either auth screen (Convocados title) or games to settle
        device.wait(Until.hasObject(By.text("Convocados")), TIMEOUT)
        Thread.sleep(1500)

        takeScreenshot("01-auth")
    }

    @Test
    fun captureGamesScreen() {
        // Launch app — if already authenticated, shows games
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(4000)

        // Wait for games list to settle (either has games or empty state)
        device.wait(Until.hasObject(By.text("Games")), TIMEOUT)
        Thread.sleep(1000)

        takeScreenshot("02-games")
    }

    @Test
    fun captureScoreScreen() {
        // Navigate to score screen by tapping a game
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(4000)

        val gameItem = findFirstGameChip()
        if (gameItem != null) {
            gameItem.click()
            Thread.sleep(3000)
            takeScreenshot("03-score")
        } else {
            // No game to open — capture the games screen instead so the suite still produces an artifact
            takeScreenshot("03-score-no-game")
        }
    }

    @Test
    fun captureTeamsScreen() {
        // Navigate to teams screen (from score screen, swipe or tap teams)
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(4000)

        val gameItem = findFirstGameChip()
        if (gameItem != null) {
            gameItem.click()
            Thread.sleep(3000)

            // Look for "Teams" button or swipe to teams
            val teamsBtn = device.findObject(By.text("Teams"))
                ?: device.findObject(By.textContains("Teams"))
            if (teamsBtn != null) {
                teamsBtn.click()
                Thread.sleep(2000)
                takeScreenshot("04-teams")
            } else {
                // Navigate via swipe up gesture (ScoreScreen: swipe up opens Teams)
                val cx = device.displayWidth / 2
                val sy = (device.displayHeight * 0.6).toInt()
                val ey = (device.displayHeight * 0.2).toInt()
                device.swipe(cx, sy, cx, ey, 20)
                Thread.sleep(2000)
                takeScreenshot("04-teams-swipe")
            }
        } else {
            takeScreenshot("04-teams-no-game")
        }
    }

    private fun findFirstGameChip(): UiObject2? {
        val excluded = setOf(
            "Games", "No games yet", "No games", "Quick Game", "History",
            "Sign Out", "Refresh", "Retry", "Pull to refresh", "Refreshing",
            "Continue game", "Offline", "Pending", "Past Games", "Hide Past",
            "Show Past", "Load more", "Convocados", "Server Settings",
            "Set to Local", "Set to Prod", "Dev Login", "Sign In",
            "Sign in with Google", "Use Email/Password",
        )
        // Try without scrolling first
        findGameCandidate(excluded)?.let { return it }
        repeat(4) {
            val cx = device.displayWidth / 2
            val sy = (device.displayHeight * 0.65).toInt()
            val ey = (device.displayHeight * 0.35).toInt()
            device.swipe(cx, sy, cx, ey, 15)
            Thread.sleep(600)
            findGameCandidate(excluded)?.let { return it }
        }
        return null
    }

    private fun findGameCandidate(excluded: Set<String>): UiObject2? {
        val candidates = device.findObjects(By.clickable(true))
        for (c in candidates) {
            val txt = c.text?.trim()
            if (!txt.isNullOrBlank() && txt !in excluded && txt.length >= 2) {
                if (txt in setOf("Teams", "Done", "Add player")) continue
                if (txt.matches(Regex("\\d+"))) continue
                return c
            }
        }
        return null
    }

    private fun takeScreenshot(name: String) {
        try {
            val file = File(outputDir, "$name.png")
            val ok = device.takeScreenshot(file)
            println("Screenshot saved: ${file.absolutePath} ok=$ok")
            // Also copy to legacy public location if we used private dir, for convenience
            try {
                val legacy = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                    "wear-screenshots/$name.png"
                )
                if (file.exists() && legacy.parentFile?.exists() == true) {
                    file.copyTo(legacy, overwrite = true)
                    println("Also copied to legacy: ${legacy.absolutePath}")
                }
            } catch (_: Exception) {}
        } catch (e: Exception) {
            println("Screenshot $name failed: ${e.message}")
            // Don't fail the test — screenshot is best-effort
        }
    }
}
