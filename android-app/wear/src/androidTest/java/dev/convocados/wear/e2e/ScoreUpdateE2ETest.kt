package dev.convocados.wear.e2e

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.cash.turbine.test
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.MyGamesResponse
import dev.convocados.wear.data.api.PaginatedHistory
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.repository.WearGameRepository
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End-to-end test: sign in → list games → open a game → update score → verify.
 *
 * This test exercises the full wear app data layer against a real backend,
 * including the local Room database for caching.
 *
 * Run against local dev server (from emulator):
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.ScoreUpdateE2ETest \
 *       -Pandroid.testInstrumentationRunnerArguments.backendUrl=http://10.0.2.2:4321 \
 *       -Pandroid.testInstrumentationRunnerArguments.testEmail=test@example.com \
 *       -Pandroid.testInstrumentationRunnerArguments.testPassword=TestPassword123
 *
 * Run against production:
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.class=dev.convocados.wear.e2e.ScoreUpdateE2ETest \
 *       -Pandroid.testInstrumentationRunnerArguments.backendUrl=https://convocados.fly.dev \
 *       -Pandroid.testInstrumentationRunnerArguments.testEmail=<your-email> \
 *       -Pandroid.testInstrumentationRunnerArguments.testPassword=<your-password>
 *
 * Prerequisites:
 *   - The backend must be running and reachable
 *   - The test user must exist and own/have joined at least one event with history
 */
@RunWith(AndroidJUnit4::class)
class ScoreUpdateE2ETest {

    private val args get() = InstrumentationRegistry.getArguments()

    private val backendUrl: String by lazy {
        args.getString("backendUrl", "http://10.0.2.2:4321")
    }
    private val testEmail: String by lazy {
        args.getString("testEmail", "test@example.com")
    }
    private val testPassword: String by lazy {
        args.getString("testPassword", "TestPassword123")
    }

    private lateinit var tokenStore: WearTokenStore
    private lateinit var apiClient: WearApiClient
    private lateinit var db: WearDatabase
    private lateinit var gameDao: WearGameDao
    private lateinit var historyDao: WearHistoryDao
    private lateinit var pendingScoreDao: PendingScoreDao
    private lateinit var repository: WearGameRepository

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val httpClient = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 10_000
        }
        followRedirects = false
    }

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        tokenStore = WearTokenStore(context)
        tokenStore.clearTokens()
        tokenStore.setServerUrl(backendUrl)

        apiClient = WearApiClient(tokenStore)

        db = Room.inMemoryDatabaseBuilder(context, WearDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        gameDao = db.gameDao()
        historyDao = db.historyDao()
        pendingScoreDao = db.pendingScoreDao()

        repository = WearGameRepository(apiClient, gameDao, historyDao, pendingScoreDao)
    }

    @After
    fun tearDown() {
        db.close()
        httpClient.close()
    }

    /**
     * Full happy-path E2E:
     * 1. Sign in via email → get session cookie
     * 2. Exchange session for OAuth access token via mobile-callback
     * 3. Fetch games → verify at least one exists
     * 4. Refresh games into local Room DB → verify cached
     * 5. Pick a game, fetch its history → find an editable entry
     * 6. Update the score via PATCH
     * 7. Re-fetch history → verify the score was persisted on the backend
     * 8. Verify the local Room DB was updated optimistically
     */
    @Test
    fun signIn_listGames_updateScore_verifyPersisted() = runTest {
        // ── Step 1: Sign in via email ────────────────────────────────────
        val signInResponse = httpClient.post("$backendUrl/api/auth/sign-in/email") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"$testEmail","password":"$testPassword"}""")
        }

        assumeTrue(
            "Sign-in failed (status=${signInResponse.status}). Is the backend running at $backendUrl with user $testEmail?",
            signInResponse.status.isSuccess(),
        )

        // Extract session cookie
        val cookies = signInResponse.headers.getAll("Set-Cookie") ?: emptyList()
        val sessionCookie = cookies.joinToString("; ") { it.substringBefore(";") }
        assumeTrue("No session cookie returned", sessionCookie.isNotBlank())

        // ── Step 2: Exchange session for OAuth token ─────────────────────
        // GET mobile-callback to get a one-time code
        val callbackResponse = httpClient.get("$backendUrl/api/auth/mobile-callback") {
            header("Cookie", sessionCookie)
            parameter("redirect_uri", "convocados://auth")
        }

        // Should be a 302 redirect to convocados://auth?code=...
        val redirectLocation = callbackResponse.headers["Location"] ?: ""
        assumeTrue(
            "mobile-callback did not redirect (status=${callbackResponse.status}, location=$redirectLocation)",
            redirectLocation.contains("code="),
        )

        val code = redirectLocation.substringAfter("code=").substringBefore("&")
        assumeTrue("Could not extract code from redirect", code.isNotBlank())

        // POST to exchange code for tokens
        val tokenResponse = httpClient.post("$backendUrl/api/auth/mobile-callback") {
            contentType(ContentType.Application.Json)
            setBody("""{"code":"$code"}""")
        }
        assumeTrue(
            "Token exchange failed (status=${tokenResponse.status})",
            tokenResponse.status.isSuccess(),
        )

        val tokenBody: TokenResponse = tokenResponse.body()
        assumeTrue("No access token returned", tokenBody.accessToken.isNotBlank())

        // Store the token
        tokenStore.setTokens(
            OAuthTokens(
                accessToken = tokenBody.accessToken,
                refreshToken = tokenBody.refreshToken ?: "",
                expiresAt = System.currentTimeMillis() + tokenBody.expiresIn * 1000,
            )
        )
        assertTrue("Should be authenticated", tokenStore.isAuthenticated.value)

        // ── Step 3: Fetch games via API ──────────────────────────────────
        val gamesResponse: MyGamesResponse = apiClient.get("/api/me/games")
        val allGames = gamesResponse.owned + gamesResponse.joined
        assumeTrue(
            "No games found for user $testEmail. Create at least one event with history first.",
            allGames.isNotEmpty(),
        )

        // ── Step 4: Refresh into local Room DB ───────────────────────────
        val refreshResult = repository.refreshGames()
        assertTrue("refreshGames should succeed", refreshResult.isSuccess)

        gameDao.getAllGames().test {
            val cached = awaitItem()
            assertTrue("Room DB should have cached games", cached.isNotEmpty())
            cancelAndIgnoreRemainingEvents()
        }

        // ── Step 5: Pick a game and fetch history ────────────────────────
        val targetGame = allGames.first()
        val historyResponse: PaginatedHistory = apiClient.get("/api/events/${targetGame.id}/history")

        // Find an editable history entry
        val editableEntry = historyResponse.data.firstOrNull { it.editable }
        assumeTrue(
            "No editable history entry found for event '${targetGame.title}' (${targetGame.id}). " +
                "The event needs at least one history entry with editableUntil in the future.",
            editableEntry != null,
        )
        val historyEntry = editableEntry!!

        // Cache history locally
        val historyRefresh = repository.refreshHistory(targetGame.id)
        assertTrue("refreshHistory should succeed", historyRefresh.isSuccess)

        // ── Step 6: Update the score ─────────────────────────────────────
        val newScoreOne = (historyEntry.scoreOne ?: 0) + 1
        val newScoreTwo = historyEntry.scoreTwo ?: 0

        val submitResult = repository.submitScore(
            eventId = targetGame.id,
            historyId = historyEntry.id,
            scoreOne = newScoreOne,
            scoreTwo = newScoreTwo,
            teamOneName = historyEntry.teamOneName,
            teamTwoName = historyEntry.teamTwoName,
        )
        assertTrue("submitScore should succeed", submitResult.isSuccess)

        // ── Step 7: Verify score persisted on backend ────────────────────
        val verifyHistory: PaginatedHistory = apiClient.get("/api/events/${targetGame.id}/history")
        val updatedEntry = verifyHistory.data.find { it.id == historyEntry.id }
        assertNotNull("History entry should still exist on backend", updatedEntry)
        assertEquals(
            "Backend scoreOne should be updated",
            newScoreOne,
            updatedEntry!!.scoreOne,
        )
        assertEquals(
            "Backend scoreTwo should be unchanged",
            newScoreTwo,
            updatedEntry.scoreTwo,
        )

        // ── Step 8: Verify local Room DB was updated optimistically ──────
        val localHistory = historyDao.getLatestHistory(targetGame.id)
        assertNotNull("Local history should exist", localHistory)
        assertEquals(
            "Local scoreOne should match",
            newScoreOne,
            localHistory!!.scoreOne,
        )
        assertEquals(
            "Local scoreTwo should match",
            newScoreTwo,
            localHistory.scoreTwo,
        )

        // No pending scores should remain (online submit succeeded)
        val pendingCount = pendingScoreDao.getAll()
        assertEquals("No pending scores should remain after successful submit", 0, pendingCount.size)
    }

    @Serializable
    private data class TokenResponse(
        @kotlinx.serialization.SerialName("access_token") val accessToken: String,
        @kotlinx.serialization.SerialName("refresh_token") val refreshToken: String? = null,
        @kotlinx.serialization.SerialName("token_type") val tokenType: String = "Bearer",
        @kotlinx.serialization.SerialName("expires_in") val expiresIn: Long = 3600,
    )
}
