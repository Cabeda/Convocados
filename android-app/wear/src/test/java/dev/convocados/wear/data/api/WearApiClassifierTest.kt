package dev.convocados.wear.data.api

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The keep/discard split for queued actions (#1343). A status code alone cannot
 * say whether an answer came from the session or from a business rule, so
 * session expiry is typed at the token endpoint and must never be classified as
 * "server wins".
 */
class WearApiClassifierTest {

    @Test
    fun `session expiry is retried, not treated as a server answer`() {
        assertTrue(SessionExpiredException("Refresh rejected (400)").isRetryableLater())
        assertTrue(ApiException(401, "unauthorized").isRetryableLater())
    }

    @Test
    fun `a business rejection surfaces instead of wedging the queue`() {
        listOf(400, 403, 404, 409, 422).forEach { code ->
            assertFalse("API $code must not be retried", ApiException(code, "rejected").isRetryableLater())
        }
    }

    @Test
    fun `network and server failures are retried`() {
        assertTrue(IOException("Offline").isRetryableLater())
        listOf(0, 408, 429, 500, 503).forEach { code ->
            assertTrue("API $code must be retried", ApiException(code, "later").isRetryableLater())
        }
        assertFalse(IllegalStateException("bug").isRetryableLater())
    }
}
