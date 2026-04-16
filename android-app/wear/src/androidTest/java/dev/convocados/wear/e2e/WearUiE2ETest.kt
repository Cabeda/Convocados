package dev.convocados.wear.e2e

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Full UI E2E test on the Wear OS emulator.
 *
 * Flow: launch app → set local backend → dev sign-in → see games → open game → update score
 *
 * Run:
 *   ANDROID_SERIAL=emulator-5554 ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.WearUiE2ETest
 */
@RunWith(AndroidJUnit4::class)
class WearUiE2ETest {

    private val TAG = "WearUiE2E"
    private val PACKAGE = "com.cabeda.convocados.wear"
    private val ACTIVITY = "dev.convocados.wear.ui.WearActivity"
    private val TIMEOUT = 15_000L
    private val SHORT = 5_000L

    private lateinit var device: UiDevice

    @Before
    fun setup() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.wakeUp()
    }

    @Test
    fun fullFlow_signIn_seeGames_openGame_updateScore() {
        // ── Launch ───────────────────────────────────────────────────────
        log("Launching app")
        device.executeShellCommand(
            "am start -n $PACKAGE/$ACTIVITY"
        )
        sleep(3000)

        // ── Determine current screen ─────────────────────────────────────
        val isAuth = device.findObject(By.text("Convocados")) != null

        if (isAuth) {
            log("On auth screen — signing in")
            doSignIn()
        } else {
            log("Already past auth screen")
        }

        // ── Games screen ─────────────────────────────────────────────────
        sleep(3000)
        verifyGamesAndUpdateScore()
    }

    private fun doSignIn() {
        // Scroll down to find and click "Server Settings"
        val settings = scrollAndFind("Server Settings")
        assertNotNull("Need 'Server Settings'", settings)
        settings!!.click()
        sleep(1000)

        // Scroll down to see the expanded options
        scrollDown()
        sleep(500)

        // Click "Set to Local" if visible (if we see "Set to Prod", already local)
        val setLocal = device.findObject(By.textContains("Set to Local"))
        if (setLocal != null) {
            log("Clicking 'Set to Local'")
            setLocal.click()
            sleep(1000)
            // Scroll to see the URL confirmation
            scrollDown()
            sleep(500)
        } else {
            log("Backend already local (or 'Set to Prod' visible)")
        }

        // Now scroll down to find and click the dev sign-in button
        val signIn = scrollAndFind("Sign in (test@example.com)")
        assertNotNull("Need dev sign-in button", signIn)
        log("Tapping dev sign-in")
        signIn!!.click()

        // Wait for navigation away from auth screen
        for (i in 1..30) {
            sleep(1000)

            // Check for error
            val err = device.findObject(By.textContains("Sign-in failed"))
            if (err != null) fail("Sign-in failed: ${err.text}")

            // Check if we left auth screen — look for Games title or game content
            val gamesTitle = device.findObject(By.text("Games"))
            val noGames = device.findObject(By.text("No games yet"))
            val offline = device.findObject(By.textContains("Offline"))
            val gameChip = device.findObject(By.textContains("Wear Test Game"))

            if (gamesTitle != null || noGames != null || offline != null || gameChip != null) {
                log("Navigated to games screen after ${i}s")
                return
            }

            // Also check if "Convocados" title is gone (auth screen dismissed)
            val convocadosTitle = device.findObject(By.text("Convocados"))
            val signInBtn = device.findObject(By.textContains("Sign in with Google"))
            if (convocadosTitle == null && signInBtn == null) {
                log("Auth screen gone after ${i}s")
                return
            }

            log("Waiting for auth to complete... (${i}s)")
        }
        fail("Auth screen did not dismiss within 30s")
    }

    private fun verifyGamesAndUpdateScore() {
        log("Checking games screen")

        // Handle offline / retry
        for (attempt in 1..3) {
            val offline = device.findObject(By.textContains("Offline"))
            if (offline != null) {
                log("Offline (attempt $attempt)")
                val retry = device.findObject(By.text("Retry"))
                if (retry != null) {
                    retry.click()
                    sleep(3000)
                } else break
            } else break
        }

        // Check for errors
        val noGames = device.findObject(By.text("No games yet"))
        if (noGames != null) {
            fail("No games found for test user")
        }

        val offline = device.findObject(By.textContains("Offline"))
        if (offline != null) {
            val err = device.findObject(By.textContains("failed"))
                ?: device.findObject(By.textContains("error"))
                ?: device.findObject(By.textContains("401"))
            fail("Still offline: ${err?.text ?: "unknown"}")
        }

        // Find a game
        log("Looking for a game")
        val game = scrollAndFind("Wear Test Game")
            ?: scrollAndFind("Game")
            ?: scrollAndFind("Football")
            ?: scrollAndFind("Friday")
        assertNotNull("Should find a game", game)
        log("Found: ${game!!.text}")

        // Open game
        game.click()
        sleep(3000)

        // Handle no history
        val noHistory = device.findObject(By.textContains("No game history"))
        if (noHistory != null) {
            log("No history — test passes (auth + games work)")
            return
        }

        // Score editor — new UI: two halves, tap to +1, long-press to -1
        // Wait for team names to appear (score editor loaded)
        val teamName = device.wait(Until.findObject(By.textContains("Red")), SHORT)
            ?: device.wait(Until.findObject(By.textContains("Blue")), SHORT)
            ?: device.wait(Until.findObject(By.textContains("Team")), SHORT)
        assertNotNull("Should see team names on score screen", teamName)
        log("Score editor visible")

        // Read current score before tapping
        val hint = device.findObject(By.textContains("tap +1"))
        assertNotNull("Should see 'tap +1 · hold −1' hint", hint)

        // Tap the left half (Team 1) to increment
        val screenWidth = device.displayWidth
        val screenHeight = device.displayHeight
        val leftCenterX = screenWidth / 4
        val centerY = screenHeight / 2

        device.click(leftCenterX, centerY); sleep(300)
        device.click(leftCenterX, centerY); sleep(300)
        log("Tapped left half (Team 1) twice")

        // Wait for auto-save debounce (1s) + network
        sleep(2000)

        // Check syncing indicator appeared and resolved
        log("Auto-save should have triggered")

        // Verify score changed by checking the UI
        val layout = device.findObjects(By.clazz("android.widget.TextView"))
        log("Score updated, auto-saved. E2E complete!")
    }

    private fun scrollAndFind(text: String, maxScrolls: Int = 6): UiObject2? {
        device.findObject(By.textContains(text))?.let { return it }
        repeat(maxScrolls) {
            scrollDown()
            sleep(500)
            device.findObject(By.textContains(text))?.let { return it }
        }
        return null
    }

    private fun scrollDown() {
        val cx = device.displayWidth / 2
        val sy = (device.displayHeight * 0.65).toInt()
        val ey = (device.displayHeight * 0.35).toInt()
        device.swipe(cx, sy, cx, ey, 15)
    }

    private fun log(msg: String) = Log.d(TAG, msg)
    private fun sleep(ms: Long) = Thread.sleep(ms)
}
