package dev.convocados.data.api

import dev.convocados.data.auth.OAuthTokenStorage
import dev.convocados.data.auth.OAuthTokens
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ApiClient @Inject constructor(
    private val tokenStore: OAuthTokenStorage,
) {
    internal constructor(tokenStore: OAuthTokenStorage, engine: HttpClientEngine) : this(tokenStore) {
        client = buildClient(engine)
    }

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private lateinit var client: HttpClient

    init {
        client = buildClient(OkHttp.create())
    }

    private fun buildClient(engine: HttpClientEngine): HttpClient = HttpClient(engine) {
        install(ContentNegotiation) { json(this@ApiClient.json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 10_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
    }

    private val baseUrl: String get() = tokenStore.getServerUrl()

    @PublishedApi
    internal suspend fun authenticatedRequest(
        method: HttpMethod,
        path: String,
        body: Any? = null,
        retry: Boolean = true,
        extraHeaders: Map<String, String> = emptyMap(),
    ): HttpResponse {
        val tokens = tokenStore.getTokens() ?: throw ApiException(401, "Not authenticated")

        var response = client.request("$baseUrl$path") {
            this.method = method
            header("Authorization", "Bearer ${tokens.accessToken}")
            extraHeaders.forEach { (k, v) -> header(k, v) }
            if (body != null) setBody(body)
        }

        if (response.status == HttpStatusCode.Unauthorized && retry) {
            refreshToken()
            val newTokens = tokenStore.getTokens() ?: throw ApiException(401, "Session expired")
            response = client.request("$baseUrl$path") {
                this.method = method
                header("Authorization", "Bearer ${newTokens.accessToken}")
                extraHeaders.forEach { (k, v) -> header(k, v) }
                if (body != null) setBody(body)
            }
        }

        if (!response.status.isSuccess()) {
            val raw = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiException(response.status.value, describeError(response.status.value, raw))
        }
        return response
    }

    @PublishedApi
    internal suspend fun refreshToken() {
        val tokens = tokenStore.getTokens() ?: throw ApiException(401, "No refresh token")
        val response = try {
            client.post("$baseUrl/api/auth/oauth2/token") {
                contentType(ContentType.Application.FormUrlEncoded)
                setBody("grant_type=refresh_token&refresh_token=${tokens.refreshToken}&client_id=convocados-mobile-app")
            }
        } catch (e: Exception) {
            // Network/timeout failure — keep the stored tokens so a later
            // refresh attempt can succeed. Only a definitive server rejection
            // of the refresh token ends the session.
            throw ApiException(0, "Network error during token refresh")
        }
        if (!response.status.isSuccess()) {
            // 401/403 = refresh token invalid/revoked → the session is over.
            // Any other failure (5xx, 429) is transient and must NOT log the
            // user out.
            if (response.status.value == 401 || response.status.value == 403) {
                tokenStore.clearTokens()
            }
            throw ApiException(response.status.value, "Token refresh failed (${response.status.value})")
        }
        val data: OAuthTokenResponse = response.body()
        tokenStore.setTokens(
            dev.convocados.data.auth.OAuthTokens(
                accessToken = data.accessToken,
                refreshToken = data.refreshToken ?: tokens.refreshToken,
                expiresAt = System.currentTimeMillis() + data.expiresIn * 1000,
            )
        )
    }

    suspend inline fun <reified T> get(path: String): T =
        authenticatedRequest(HttpMethod.Get, path).body()

    suspend inline fun <reified T> post(path: String, body: Any? = null): T =
        authenticatedRequest(HttpMethod.Post, path, body).body()

    suspend inline fun <reified T> put(path: String, body: Any? = null): T =
        authenticatedRequest(HttpMethod.Put, path, body).body()

    suspend inline fun <reified T> patch(path: String, body: Any? = null): T =
        authenticatedRequest(HttpMethod.Patch, path, body).body()

    suspend inline fun <reified T> delete(path: String, body: Any? = null): T =
        authenticatedRequest(HttpMethod.Delete, path, body).body()

    suspend inline fun <reified T> postWithHeader(
        path: String,
        headerName: String,
        headerValue: String,
        body: Any? = null,
    ): T =
        authenticatedRequest(HttpMethod.Post, path, body, extraHeaders = mapOf(headerName to headerValue)).body()

    /** Unauthenticated POST for token exchange */
    suspend fun exchangeCode(code: String): OAuthTokenResponse {
        val response = client.post("$baseUrl/api/auth/mobile-callback") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("code" to code))
        }
        if (!response.status.isSuccess()) {
            throw ApiException(response.status.value, "Token exchange failed")
        }
        return response.body()
    }

    fun getLoginUrl(redirectUri: String): String =
        "$baseUrl/api/auth/mobile-callback?redirect_uri=${redirectUri.encodeURLParameter()}"

    suspend fun fetchCalendarIcs(eventId: String): String {
        val response = authenticatedRequest(HttpMethod.Get, "/api/events/$eventId/calendar")
        return response.bodyAsText()
    }
}

class ApiException(val code: Int, message: String) : Exception(message)

/**
 * Turn an HTTP error body into a short human-readable message.
 *
 * Priority: the JSON `error` field → `message` field → plain text (truncated)
 * → a generic status string. HTML bodies (e.g. Astro's SPA fallback for an
 * unmatched API path) are never surfaced raw — they render as markup soup in
 * Compose Text.
 */
internal fun describeError(status: Int, body: String): String {
    val trimmed = body.trim()
    if (trimmed.isEmpty()) return "Request failed ($status)"

    // JSON error field — parse defensively; a malformed body falls through.
    if (trimmed.startsWith("{")) {
        runCatching {
            val json = Json { ignoreUnknownKeys = true }
            val obj = json.parseToJsonElement(trimmed).jsonObject
            val err = (obj["error"] as? JsonPrimitive)?.content
            if (!err.isNullOrBlank()) return err
            val msg = (obj["message"] as? JsonPrimitive)?.content
            if (!msg.isNullOrBlank()) return msg
        }
    }

    if (trimmed.startsWith("<")) return "Server error ($status)"
    return trimmed.take(200)
}
