package dev.convocados.wear.data.api

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearTokenStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Integration tests for WearApiClient against a real backend.
 *
 * These tests require either:
 * - A local dev server at http://10.0.2.2:4321 (emulator) or http://localhost:4321 (device)
 * - Or the production server at https://convocados.fly.dev
 *
 * The backend URL is read from the instrumentation argument "backendUrl".
 * Run with:
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.backendUrl=http://10.0.2.2:4321
 *
 * Or for production:
 *   ./gradlew :wear:connectedDebugAndroidTest \
 *       -Pandroid.testInstrumentationRunnerArguments.backendUrl=https://convocados.fly.dev
 *
 * You must also pass a valid access token:
 *   -Pandroid.testInstrumentationRunnerArguments.accessToken=<token>
 *
 * To get a token for local dev, use the Bruno auth flow or the bypass endpoint.
 */
@RunWith(AndroidJUnit4::class)
class WearApiClientIntegrationTest {

    private lateinit var tokenStore: WearTokenStore
    private lateinit var client: WearApiClient

    private val backendUrl: String by lazy {
        InstrumentationRegistry.getArguments()
            .getString("backendUrl", "http://10.0.2.2:4321")
    }

    private val accessToken: String by lazy {
        InstrumentationRegistry.getArguments()
            .getString("accessToken", "")
    }

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        tokenStore = WearTokenStore(context)
        tokenStore.setServerUrl(backendUrl)

        if (accessToken.isNotEmpty()) {
            tokenStore.setTokens(
                OAuthTokens(
                    accessToken = accessToken,
                    refreshToken = "test_refresh",
                    expiresAt = System.currentTimeMillis() + 3600_000,
                )
            )
        }

        client = WearApiClient(tokenStore)
    }

    @Test
    fun fetchMyGames_returns_valid_response() = runTest {
        skipIfNoToken()

        val response: MyGamesResponse = client.get("/api/me/games")

        // Should deserialize without error; lists may be empty but not null
        assertNotNull(response.owned)
        assertNotNull(response.joined)
    }

    @Test
    fun fetchMyGames_owned_games_have_required_fields() = runTest {
        skipIfNoToken()

        val response: MyGamesResponse = client.get("/api/me/games")

        for (game in response.owned) {
            assertTrue("Game id should not be blank", game.id.isNotBlank())
            assertTrue("Game title should not be blank", game.title.isNotBlank())
            assertTrue("Game dateTime should not be blank", game.dateTime.isNotBlank())
            assertTrue("maxPlayers should be > 0", game.maxPlayers > 0)
        }
    }

    @Test
    fun fetchHistory_returns_paginated_response() = runTest {
        skipIfNoToken()

        // First get a game to use its ID
        val games: MyGamesResponse = client.get("/api/me/games")
        val firstGame = (games.owned + games.joined).firstOrNull()
            ?: return@runTest // Skip if no games

        val history: PaginatedHistory = client.get("/api/events/${firstGame.id}/history")

        assertNotNull(history.data)
        // data may be empty for games without history
    }

    @Test
    fun fetchHistory_entries_have_required_fields() = runTest {
        skipIfNoToken()

        val games: MyGamesResponse = client.get("/api/me/games")
        val firstGame = (games.owned + games.joined).firstOrNull()
            ?: return@runTest

        val history: PaginatedHistory = client.get("/api/events/${firstGame.id}/history")

        for (entry in history.data) {
            assertTrue("History id should not be blank", entry.id.isNotBlank())
            assertTrue("History dateTime should not be blank", entry.dateTime.isNotBlank())
        }
    }

    @Test
    fun unauthenticated_request_throws_ApiException() = runTest {
        tokenStore.clearTokens()

        try {
            client.get<MyGamesResponse>("/api/me/games")
            fail("Expected ApiException for unauthenticated request")
        } catch (e: ApiException) {
            assertEquals(401, e.code)
        }
    }

    private fun skipIfNoToken() {
        if (accessToken.isEmpty()) {
            // Use org.junit.Assume to skip gracefully
            org.junit.Assume.assumeTrue(
                "Skipping: no accessToken provided via instrumentation args",
                false,
            )
        }
    }
}
