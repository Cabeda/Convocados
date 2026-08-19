package dev.convocados.data.api

import dev.convocados.data.auth.OAuthTokenStorage
import dev.convocados.data.auth.OAuthTokens
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Regression tests: a failed token refresh must not log the user out unless the
 * server definitively rejects the refresh token. Transient failures (network
 * blips, 5xx, 429) must preserve the stored tokens so the session survives and
 * the next refresh attempt can succeed.
 */
class ApiClientRefreshTest {

    private class FakeTokenStore(var stored: OAuthTokens? = null) : OAuthTokenStorage {
        override fun getTokens(): OAuthTokens? = stored
        override fun setTokens(tokens: OAuthTokens) {
            stored = tokens
        }

        override fun clearTokens() {
            stored = null
        }

        override fun getServerUrl(): String = "https://example.test"
    }

    private fun client(engine: MockEngine, store: FakeTokenStore): ApiClient =
        ApiClient(store, engine)

    private fun refreshResponse(status: HttpStatusCode): MockEngine = MockEngine { request ->
        respond(
            content = """{"access_token":"fresh_access","refresh_token":"fresh_refresh","expires_in":3600}""",
            status = status,
            headers = headersOf(HttpHeaders.ContentType, "application/json"),
        )
    }

    @Test
    fun refresh_success_stores_new_tokens() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "old_refresh", System.currentTimeMillis() - 60_000)
        )
        val client = client(refreshResponse(HttpStatusCode.OK), store)

        client.refreshToken()

        val tokens = store.getTokens()
        assertNotNull(tokens)
        assertEquals("fresh_access", tokens?.accessToken)
        assertEquals("fresh_refresh", tokens?.refreshToken)
        assertTrue((tokens?.expiresAt ?: 0) > System.currentTimeMillis())
    }

    @Test
    fun refresh_401_rejects_refresh_token_clears_session() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "dead_refresh", System.currentTimeMillis() - 60_000)
        )
        val client = client(refreshResponse(HttpStatusCode.Unauthorized), store)

        try {
            client.refreshToken()
            fail("Expected ApiException for rejected refresh token")
        } catch (e: ApiException) {
            assertEquals(401, e.code)
        }

        assertNull("Session must be cleared when the refresh token is rejected", store.getTokens())
    }

    @Test
    fun refresh_403_rejects_refresh_token_clears_session() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "dead_refresh", System.currentTimeMillis() - 60_000)
        )
        val client = client(refreshResponse(HttpStatusCode.Forbidden), store)

        try {
            client.refreshToken()
            fail("Expected ApiException for rejected refresh token")
        } catch (e: ApiException) {
            assertEquals(403, e.code)
        }

        assertNull("Session must be cleared when the refresh token is rejected", store.getTokens())
    }

    @Test
    fun refresh_5xx_keeps_session() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "still_valid_refresh", System.currentTimeMillis() - 60_000)
        )
        val client = client(refreshResponse(HttpStatusCode.InternalServerError), store)

        try {
            client.refreshToken()
            fail("Expected ApiException for 5xx refresh response")
        } catch (e: ApiException) {
            assertEquals(500, e.code)
        }

        val tokens = store.getTokens()
        assertNotNull("Tokens must survive a transient 5xx refresh failure", tokens)
        assertEquals("old_access", tokens?.accessToken)
        assertEquals("still_valid_refresh", tokens?.refreshToken)
    }

    @Test
    fun refresh_429_keeps_session() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "still_valid_refresh", System.currentTimeMillis() - 60_000)
        )
        val client = client(refreshResponse(HttpStatusCode.TooManyRequests), store)

        try {
            client.refreshToken()
            fail("Expected ApiException for 429 refresh response")
        } catch (e: ApiException) {
            assertEquals(429, e.code)
        }

        val tokens = store.getTokens()
        assertNotNull("Tokens must survive a 429 refresh failure", tokens)
        assertEquals("still_valid_refresh", tokens?.refreshToken)
    }

    @Test
    fun refresh_network_error_keeps_session() = runTest {
        val store = FakeTokenStore(
            OAuthTokens("old_access", "still_valid_refresh", System.currentTimeMillis() - 60_000)
        )
        val engine = MockEngine { request ->
            throw java.io.IOException("boom")
        }
        val client = client(engine, store)

        try {
            client.refreshToken()
            fail("Expected ApiException for network error during refresh")
        } catch (e: ApiException) {
            assertEquals(0, e.code)
        }

        val tokens = store.getTokens()
        assertNotNull("Tokens must survive a network failure during refresh", tokens)
        assertEquals("still_valid_refresh", tokens?.refreshToken)
    }
}