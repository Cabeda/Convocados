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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Regression tests: error responses must surface a readable message, never a
 * raw HTML page. When the server returns an Astro HTML fallback (e.g. for an
 * unmatched API path) or any non-JSON body, ApiException.message must be a
 * short human-readable string — not the full markup.
 */
class ApiClientErrorBodyTest {

    private class FakeTokenStore(var stored: OAuthTokens? = null) : OAuthTokenStorage {
        override fun getTokens(): OAuthTokens? = stored
        override fun setTokens(tokens: OAuthTokens) { stored = tokens }
        override fun clearTokens() { stored = null }
        override fun getServerUrl(): String = "https://example.test"
    }

    private fun clientFor(status: HttpStatusCode, body: String, contentType: String = "text/html"): ApiClient {
        val engine = MockEngine { _ ->
            respond(
                content = body,
                status = status,
                headers = headersOf(HttpHeaders.ContentType, contentType),
            )
        }
        return ApiClient(
            FakeTokenStore(OAuthTokens("a", "r", System.currentTimeMillis() + 3600_000)),
            engine,
        )
    }

    @Test
    fun json_error_body_extracts_error_field() = runTest {
        val client = clientFor(
            HttpStatusCode.Conflict,
            """{"error":"This user has turned off game invites."}""",
            contentType = "application/json",
        )
        try {
            client.get<String>("/api/x")
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(409, e.code)
            assertEquals("This user has turned off game invites.", e.message)
        }
    }

    @Test
    fun html_error_body_is_replaced_with_short_message() = runTest {
        val html = "<!DOCTYPE html><html><head><title>Convocados</title></head><body>" +
            "<div class=\"astro\">" + "x".repeat(5000) + "</div></body></html>"
        val client = clientFor(HttpStatusCode.NotFound, html)
        try {
            client.get<String>("/api/invite/")
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(404, e.code)
            assertNotNull(e.message)
            assertFalse("Message must not contain raw HTML", e.message!!.contains("<"))
            assertTrue("Message must be short", e.message!!.length < 200)
        }
    }

    @Test
    fun json_without_error_field_falls_back_to_short_message() = runTest {
        val client = clientFor(
            HttpStatusCode.InternalServerError,
            """{"unexpected":"shape"}""",
            contentType = "application/json",
        )
        try {
            client.get<String>("/api/x")
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(500, e.code)
            assertNotNull(e.message)
            assertFalse(e.message!!.contains("<"))
        }
    }

    @Test
    fun long_plain_text_body_is_truncated() = runTest {
        val client = clientFor(HttpStatusCode.BadGateway, "y".repeat(3000), contentType = "text/plain")
        try {
            client.get<String>("/api/x")
            fail("Expected ApiException")
        } catch (e: ApiException) {
            assertEquals(502, e.code)
            assertNotNull(e.message)
            assertTrue("Message must be truncated", e.message!!.length <= 200)
        }
    }
}
