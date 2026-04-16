package dev.convocados.wear.e2e

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.ktor.client.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.URL

/**
 * Diagnostic E2E test to replicate the "Offline — showing cached" issue.
 *
 * Run on emulator with local dev server running:
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.ConnectivityDiagnosticTest \
 *       -Pandroid.testInstrumentationRunnerArguments.backendUrl=http://10.0.2.2:4321
 */
@RunWith(AndroidJUnit4::class)
class ConnectivityDiagnosticTest {

    private val TAG = "ConnectivityDiag"

    private val backendUrl: String by lazy {
        InstrumentationRegistry.getArguments()
            .getString("backendUrl", "http://10.0.2.2:4321")
    }

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val ktorClient = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 10_000
            connectTimeoutMillis = 8_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
        followRedirects = false
    }

    @After
    fun tearDown() {
        ktorClient.close()
    }

    /**
     * Step 1: Can we reach the backend at all?
     * Tests raw HTTP connectivity to the health endpoint.
     */
    @Test
    fun step1_raw_http_connectivity() = runTest {
        Log.d(TAG, "Testing raw HTTP to $backendUrl/api/health")

        try {
            val url = URL("$backendUrl/api/health")
            val connection = url.openConnection()
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            val response = connection.getInputStream().bufferedReader().readText()
            Log.d(TAG, "Raw HTTP response: $response")
            assertTrue("Health endpoint should return ok", response.contains("ok"))
        } catch (e: Exception) {
            Log.e(TAG, "Raw HTTP failed: ${e.javaClass.simpleName}: ${e.message}", e)
            fail("Cannot reach $backendUrl/api/health: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /**
     * Step 2: Can Ktor reach the backend?
     * Tests if the Ktor OkHttp engine can make cleartext requests.
     */
    @Test
    fun step2_ktor_health_check() = runTest {
        Log.d(TAG, "Testing Ktor HTTP to $backendUrl/api/health")

        try {
            val response = ktorClient.get("$backendUrl/api/health")
            val body = response.bodyAsText()
            Log.d(TAG, "Ktor response: status=${response.status}, body=$body")
            assertTrue("Health should return 200", response.status.isSuccess())
            assertTrue("Health should contain ok", body.contains("ok"))
        } catch (e: Exception) {
            Log.e(TAG, "Ktor HTTP failed: ${e.javaClass.simpleName}: ${e.message}", e)
            fail("Ktor cannot reach $backendUrl/api/health: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /**
     * Step 3: Can we sign in with email/password?
     */
    @Test
    fun step3_email_sign_in() = runTest {
        Log.d(TAG, "Testing email sign-in at $backendUrl")

        try {
            val response = ktorClient.post("$backendUrl/api/auth/sign-in/email") {
                contentType(ContentType.Application.Json)
                setBody("""{"email":"test@example.com","password":"TestPassword123"}""")
            }
            val body = response.bodyAsText()
            Log.d(TAG, "Sign-in response: status=${response.status}, body=${body.take(200)}")
            Log.d(TAG, "Sign-in cookies: ${response.headers.getAll("Set-Cookie")}")

            assertTrue(
                "Sign-in should succeed (got ${response.status}). Body: ${body.take(200)}",
                response.status.isSuccess(),
            )

            val cookies = response.headers.getAll("Set-Cookie")
            assertFalse("Should return session cookies", cookies.isNullOrEmpty())
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in failed: ${e.javaClass.simpleName}: ${e.message}", e)
            fail("Sign-in failed: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /**
     * Step 4: Full flow — sign in, get code, exchange for token, fetch games.
     */
    @Test
    fun step4_full_auth_and_fetch_games() = runTest {
        Log.d(TAG, "Testing full auth flow at $backendUrl")

        // Sign in
        val signInResponse = ktorClient.post("$backendUrl/api/auth/sign-in/email") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"test@example.com","password":"TestPassword123"}""")
        }
        assertTrue("Sign-in should succeed", signInResponse.status.isSuccess())

        val cookies = signInResponse.headers.getAll("Set-Cookie")
            ?.joinToString("; ") { it.substringBefore(";") }
            ?: fail("No cookies")
        Log.d(TAG, "Got cookies: $cookies")

        // Get mobile-callback code
        val callbackResponse = ktorClient.get("$backendUrl/api/auth/mobile-callback") {
            header("Cookie", cookies)
            parameter("redirect_uri", "convocados://auth")
        }
        Log.d(TAG, "Callback status: ${callbackResponse.status}")
        Log.d(TAG, "Callback location: ${callbackResponse.headers["Location"]}")

        val location = callbackResponse.headers["Location"] ?: ""
        assertTrue("Should redirect with code", location.contains("code="))

        val code = location.substringAfter("code=").substringBefore("&")
        Log.d(TAG, "Got code: ${code.take(10)}...")

        // Exchange code for tokens
        val tokenResponse = ktorClient.post("$backendUrl/api/auth/mobile-callback") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"$code"}""")
        }
        val tokenBody = tokenResponse.bodyAsText()
        Log.d(TAG, "Token response: status=${tokenResponse.status}, body=${tokenBody.take(200)}")
        assertTrue("Token exchange should succeed", tokenResponse.status.isSuccess())
        assertTrue("Should contain access_token", tokenBody.contains("access_token"))

        // Extract access token
        val accessToken = json.decodeFromString<Map<String, kotlinx.serialization.json.JsonElement>>(tokenBody)
        val token = accessToken["access_token"].toString().trim('"')
        Log.d(TAG, "Got access token: ${token.take(10)}...")

        // Fetch games
        val gamesResponse = ktorClient.get("$backendUrl/api/me/games") {
            header("Authorization", "Bearer $token")
        }
        val gamesBody = gamesResponse.bodyAsText()
        Log.d(TAG, "Games response: status=${gamesResponse.status}, body=${gamesBody.take(500)}")
        assertTrue("Games should return 200", gamesResponse.status.isSuccess())
        assertTrue("Should contain owned field", gamesBody.contains("owned"))
    }
}
