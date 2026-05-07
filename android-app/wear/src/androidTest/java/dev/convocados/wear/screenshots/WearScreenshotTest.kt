package dev.convocados.wear.screenshots

import android.graphics.Bitmap
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Automated screenshot generator for Wear OS app.
 *
 * Run:
 *   cd android-app
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.screenshots.WearScreenshotTest
 *
 * Screenshots are saved to /sdcard/Pictures/wear-screenshots/ on the device.
 * Pull them with:
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
        outputDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
            "wear-screenshots"
        )
        outputDir.mkdirs()
    }

    @Test
    fun captureAuthScreen() {
        // Clear app data to ensure auth screen shows
        device.executeShellCommand("pm clear $PACKAGE")
        Thread.sleep(2000)

        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(5000)

        takeScreenshot("01-auth")
    }

    @Test
    fun captureGamesScreen() {
        // Launch app — if already authenticated, shows games
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(5000)

        // If we see the games list (has items or "No games" text)
        val hasGames = device.wait(Until.hasObject(By.textContains("Game")), TIMEOUT)
            ?: device.wait(Until.hasObject(By.textContains("No")), 3000)

        takeScreenshot("02-games")
    }

    @Test
    fun captureScoreScreen() {
        // Navigate to score screen by tapping a game
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(5000)

        // Try to tap the first game item
        val gameItem = device.findObject(By.clickable(true).hasDescendant(By.textContains("Game")))
        if (gameItem != null) {
            gameItem.click()
            Thread.sleep(3000)
            takeScreenshot("03-score")
        }
    }

    @Test
    fun captureTeamsScreen() {
        // Navigate to teams screen (from score screen, swipe or tap teams)
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(5000)

        val gameItem = device.findObject(By.clickable(true).hasDescendant(By.textContains("Game")))
        if (gameItem != null) {
            gameItem.click()
            Thread.sleep(3000)

            // Look for "Teams" button or swipe to teams
            val teamsBtn = device.findObject(By.text("Teams"))
            if (teamsBtn != null) {
                teamsBtn.click()
                Thread.sleep(3000)
                takeScreenshot("04-teams")
            }
        }
    }

    private fun takeScreenshot(name: String) {
        val file = File(outputDir, "$name.png")
        device.takeScreenshot(file)
        println("Screenshot saved: ${file.absolutePath}")
    }
}
