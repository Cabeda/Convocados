package dev.convocados.wear.screenshots

import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearTokenStore
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Automated screenshot generator for the Wear OS app.
 *
 * Authenticated screens are captured against a LOCAL dev server seeded with
 * demo data (`npm run db:seed`). The seed creates a demo organizer that owns
 * the "Just Ended — Close the Game!" event, which is what the game/score/teams
 * screenshots display.
 *
 * Prerequisites:
 *   - Local dev server running and reachable from the emulator (10.0.2.2:4321)
 *   - Database seeded: `npm run db:seed`
 *
 * Run:
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.screenshots.WearScreenshotTest
 */
@RunWith(AndroidJUnit4::class)
class WearScreenshotTest {

    private val PACKAGE = "com.cabeda.Convocados"
    private val ACTIVITY = "dev.convocados.wear.ui.WearActivity"
    private val TIMEOUT = 20_000L
    private val DEMO_GAME = "Just Ended"

    private val args get() = InstrumentationRegistry.getArguments()
    private val backendUrl by lazy { args.getString("backendUrl", "http://10.0.2.2:4321") }
    private val demoEmail by lazy { args.getString("testEmail", "demo@convocados.app") }
    private val demoPassword by lazy { args.getString("testPassword", "demo123") }

    private lateinit var device: UiDevice
    private lateinit var outputDir: File

    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }
    private val http = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) { requestTimeoutMillis = 15_000; connectTimeoutMillis = 10_000 }
        followRedirects = false
    }

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
    fun capture01Auth() {
        tokenStore().clearTokens()
        launchFresh()
        device.wait(Until.hasObject(By.textContains("Convocados")), TIMEOUT)
        takeScreenshot("01-auth")
    }

    @Test
    fun capture02Games() {
        signInDemo()
        launchFresh()
        device.wait(Until.hasObject(By.textContains(DEMO_GAME)), TIMEOUT)
        takeScreenshot("02-games-list")
    }

    @Test
    fun capture03Score() {
        signInDemo()
        launchFresh()
        device.wait(Until.findObject(By.textContains(DEMO_GAME)), TIMEOUT)?.click()
        device.wait(Until.hasObject(By.textContains("Ninjas")), TIMEOUT)
        takeScreenshot("03-score-activity")
    }

    @Test
    fun capture04Teams() {
        signInDemo()
        launchFresh()
        device.wait(Until.findObject(By.textContains(DEMO_GAME)), TIMEOUT)?.click()
        device.wait(Until.hasObject(By.textContains("Ninjas")), TIMEOUT)

        // Swipe up to open the Teams screen
        device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 30)
        device.wait(Until.hasObject(By.text("Teams")), TIMEOUT)
        takeScreenshot("04-teams-edit")
    }

    /** Force-stop then start the activity so the app re-reads the seeded auth/server prefs. */
    private fun launchFresh() {
        device.executeShellCommand("am force-stop $PACKAGE")
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
    }

    private fun tokenStore() =
        WearTokenStore(InstrumentationRegistry.getInstrumentation().targetContext)

    /** Sign in against the local seeded backend and persist real OAuth tokens. */
    private fun signInDemo() = runBlocking {
        val store = tokenStore()
        store.clearTokens()
        store.setServerUrl(backendUrl)

        val signIn = http.post("$backendUrl/api/auth/sign-in/email") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"$demoEmail","password":"$demoPassword"}""")
        }
        val cookie = (signIn.headers.getAll("Set-Cookie") ?: emptyList())
            .joinToString("; ") { it.substringBefore(";") }

        val callback = http.get("$backendUrl/api/auth/mobile-callback") {
            header("Cookie", cookie)
            parameter("redirect_uri", "convocados://auth")
        }
        val code = (callback.headers["Location"] ?: "").substringAfter("code=").substringBefore("&")

        val tokens: TokenResponse = http.post("$backendUrl/api/auth/mobile-callback") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"$code"}""")
        }.body()

        store.setTokens(
            OAuthTokens(
                accessToken = tokens.accessToken,
                refreshToken = tokens.refreshToken ?: "",
                expiresAt = System.currentTimeMillis() + tokens.expiresIn * 1000,
            )
        )
    }

    private fun takeScreenshot(name: String) {
        val file = File(outputDir, "$name.png")
        device.takeScreenshot(file)
        println("Screenshot saved: ${file.absolutePath}")
    }

    @Serializable
    private data class TokenResponse(
        @SerialName("access_token") val accessToken: String,
        @SerialName("refresh_token") val refreshToken: String? = null,
        @SerialName("expires_in") val expiresIn: Long = 3600,
    )
}
