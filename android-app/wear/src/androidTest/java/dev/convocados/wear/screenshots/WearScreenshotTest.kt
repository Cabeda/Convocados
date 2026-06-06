package dev.convocados.wear.screenshots

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import dagger.hilt.android.EntryPointAccessors
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.data.auth.WearTokenStoreEntryPoint
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
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Automated screenshot generator for the Wear OS app.
 *
 * Authenticated screens are captured against a LOCAL dev server seeded with
 * demo data (`npm run db:seed`). The seed creates a demo organizer that owns
 * the "Just Ended — Close the Game!" event, shown in the game/score/teams shots.
 *
 * The instrumentation shares the app process, so auth is driven through the
 * app's live singleton [WearTokenStore] (its StateFlow makes the UI react),
 * never by force-stopping the package (which would kill the test runner).
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
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
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
    }

    @Test
    fun capture01Auth() {
        tokenStore().clearTokens()
        launchActivity()
        device.wait(Until.hasObject(By.textContains("Convocados")), TIMEOUT)
        takeScreenshot("01-auth")
    }

    @Test
    fun capture02Games() {
        signInDemo()
        launchActivity()
        device.wait(Until.hasObject(By.textContains(DEMO_GAME)), TIMEOUT)
        takeScreenshot("02-games-list")
    }

    @Test
    fun capture03Score() {
        signInDemo()
        launchActivity()
        device.wait(Until.findObject(By.textContains(DEMO_GAME)), TIMEOUT)?.click()
        device.wait(Until.hasObject(By.textContains("Ninjas")), TIMEOUT)
        takeScreenshot("03-score-activity")
    }

    @Test
    fun capture04Teams() {
        signInDemo()
        launchActivity()
        device.wait(Until.findObject(By.textContains(DEMO_GAME)), TIMEOUT)?.click()
        device.wait(Until.hasObject(By.textContains("Ninjas")), TIMEOUT)

        // Swipe up to open the Teams screen
        device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 30)
        device.wait(Until.hasObject(By.text("Teams")), TIMEOUT)
        takeScreenshot("04-teams-edit")
    }

    /** Start (or bring to front) the activity — never force-stop, which would kill the test runner. */
    private fun launchActivity() {
        device.executeShellCommand("am start -n $PACKAGE/$ACTIVITY")
        Thread.sleep(1500)
    }

    /** The app's live singleton token store (shared Hilt component). */
    private fun tokenStore(): WearTokenStore {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        return EntryPointAccessors.fromApplication(app, WearTokenStoreEntryPoint::class.java).tokenStore()
    }

    /** Sign in against the local seeded backend and set real OAuth tokens on the live store. */
    private fun signInDemo() = runBlocking {
        val store = tokenStore()
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
        // screencap runs as the shell user and writes to /data/local/tmp, which is
        // pullable via adb and survives the app being uninstalled after the run.
        device.executeShellCommand("screencap -p /data/local/tmp/$name.png")
        println("Screenshot saved: /data/local/tmp/$name.png")
    }

    @Serializable
    private data class TokenResponse(
        @SerialName("access_token") val accessToken: String,
        @SerialName("refresh_token") val refreshToken: String? = null,
        @SerialName("expires_in") val expiresIn: Long = 3600,
    )
}
