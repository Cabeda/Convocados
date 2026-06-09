package dev.convocados.wear.data.api

import dev.convocados.wear.data.auth.OAuthTokens
import dev.convocados.wear.data.auth.WearTokenStore
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.inject.Inject
import javax.inject.Singleton
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

@Singleton
class WearApiClient @Inject constructor(private val tokenStore: WearTokenStore) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(this@WearApiClient.json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 10_000
            connectTimeoutMillis = 8_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
        followRedirects = false
        if (dev.convocados.wear.BuildConfig.DEBUG) {
            engine {
                config {
                    sslSocketFactory(
                        trustAllSslContext.socketFactory,
                        trustAllCerts[0] as X509TrustManager,
                    )
                    hostnameVerifier { _, _ -> true }
                }
            }
        }
    }

    private val baseUrl: String get() = tokenStore.getServerUrl()

    @PublishedApi
    internal suspend fun authenticatedRequest(
        method: HttpMethod,
        path: String,
        body: Any? = null,
        retry: Boolean = true,
    ): HttpResponse {
        val tokens = tokenStore.getTokens() ?: throw ApiException(401, "Not authenticated")

        var response = client.request("$baseUrl$path") {
            this.method = method
            header("Authorization", "Bearer ${tokens.accessToken}")
            if (body != null) setBody(body)
        }

        if (response.status == HttpStatusCode.Unauthorized && retry) {
            refreshToken()
            val newTokens = tokenStore.getTokens() ?: throw ApiException(401, "Session expired")
            response = client.request("$baseUrl$path") {
                this.method = method
                header("Authorization", "Bearer ${newTokens.accessToken}")
                if (body != null) setBody(body)
            }
        }

        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiException(response.status.value, errorBody)
        }
        return response
    }

    @PublishedApi
    internal suspend fun refreshToken() {
        val tokens = tokenStore.getTokens() ?: throw ApiException(401, "No refresh token")
        val response = try {
            client.post("$baseUrl/api/auth/oauth2/token") {
                contentType(ContentType.Application.FormUrlEncoded)
                setBody("grant_type=refresh_token&refresh_token=${tokens.refreshToken}&client_id=mobile-app")
            }
        } catch (e: Exception) {
            throw ApiException(0, "Network error during refresh: ${e.message}")
        }
        if (!response.status.isSuccess()) {
            if (response.status.value == 401 || response.status.value == 403) {
                tokenStore.clearTokens()
            }
            throw ApiException(response.status.value, "Refresh failed (${response.status.value})")
        }
        val data: OAuthTokenResponse = response.body()
        tokenStore.setTokens(
            OAuthTokens(
                accessToken = data.accessToken,
                refreshToken = data.refreshToken ?: tokens.refreshToken,
                expiresAt = System.currentTimeMillis() + data.expiresIn * 1000,
            )
        )
    }

    suspend inline fun <reified T> get(path: String): T =
        authenticatedRequest(HttpMethod.Get, path).body()

    suspend inline fun <reified T> patch(path: String, body: Any? = null): T =
        authenticatedRequest(HttpMethod.Patch, path, body).body()

    suspend fun getTeams(eventId: String): TeamsResponse =
        get("/api/events/$eventId/teams")

    suspend fun updateTeams(eventId: String, request: UpdateTeamsRequest): TeamsResponse =
        patch("/api/events/$eventId/teams", request)

    /**
     * Start score tracking for an event: auto-creates today's game-history
     * record (requires teams to be assigned). Idempotent — returns the
     * existing record if one already exists for today.
     */
    suspend fun startWatchGame(eventId: String) {
        authenticatedRequest(HttpMethod.Post, "/api/watch/events", mapOf("eventId" to eventId))
    }

    /**
     * Exchange email/password for Convocados OAuth tokens.
     */
    suspend fun loginWithEmail(email: String, password: String): OAuthTokenResponse {
        val response = client.post("$baseUrl/api/auth/sign-in/email") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("email" to email, "password" to password))
        }
        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiException(response.status.value, "Email login failed: $errorBody")
        }
        return response.body()
    }

    /**
     * Exchange a Google ID token for Convocados OAuth tokens (standalone, no phone).
     *
     * 1. Signs in to better-auth using the Google ID token (built-in social
     *    sign-in with ID token) to obtain a session cookie.
     * 2. Exchanges that session for OAuth access/refresh tokens via the
     *    mobile-callback flow (same as the email path).
     */
    suspend fun exchangeGoogleToken(idToken: String): OAuthTokenResponse {
        val signInResponse = client.post("$baseUrl/api/auth/sign-in/social") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("provider", "google")
                putJsonObject("idToken") { put("token", idToken) }
            })
        }
        if (!signInResponse.status.isSuccess()) {
            val errorBody = runCatching { signInResponse.bodyAsText() }.getOrDefault("")
            throw ApiException(signInResponse.status.value, "Google sign-in failed: $errorBody")
        }

        val cookies = signInResponse.headers.getAll("Set-Cookie")
            ?.joinToString("; ") { it.substringBefore(";") }
            ?: throw ApiException(401, "No session cookie returned")

        return exchangeSessionForTokens(cookies)
    }

    /**
     * Given a better-auth session cookie, run the mobile-callback flow to get
     * OAuth access/refresh tokens for the mobile-app client.
     */
    private suspend fun exchangeSessionForTokens(cookies: String): OAuthTokenResponse {
        // GET mobile-callback to get a one-time code (redirect carries it)
        val callbackResponse = client.get("$baseUrl/api/auth/mobile-callback") {
            header("Cookie", cookies)
            parameter("redirect_uri", "convocados://auth")
        }

        val redirectLocation = callbackResponse.headers["Location"]
            ?: throw ApiException(400, "No redirect from mobile-callback")

        val code = redirectLocation.substringAfter("code=").substringBefore("&")
        if (code.isBlank()) throw ApiException(400, "No code in redirect: $redirectLocation")

        // Exchange the one-time code for OAuth tokens
        val tokenResponse = client.post("$baseUrl/api/auth/mobile-callback") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("code" to code))
        }
        if (!tokenResponse.status.isSuccess()) {
            val errorBody = runCatching { tokenResponse.bodyAsText() }.getOrDefault("")
            throw ApiException(tokenResponse.status.value, "Token exchange failed: $errorBody")
        }
        return tokenResponse.body()
    }

    /**
     * Sign in with email/password, then exchange the session for OAuth tokens
     * via the mobile-callback flow. Used for local dev bypass on the watch.
     */
    suspend fun signInWithEmail(email: String, password: String): OAuthTokenResponse {
        // Step 1: Sign in to get a session cookie
        val signInResponse = client.post("$baseUrl/api/auth/sign-in/email") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("email" to email, "password" to password))
        }
        if (!signInResponse.status.isSuccess()) {
            val errorBody = runCatching { signInResponse.bodyAsText() }.getOrDefault("")
            throw ApiException(signInResponse.status.value, "Sign-in failed: $errorBody")
        }

        // Extract session cookie
        val cookies = signInResponse.headers.getAll("Set-Cookie")
            ?.joinToString("; ") { it.substringBefore(";") }
            ?: throw ApiException(401, "No session cookie returned")

        return exchangeSessionForTokens(cookies)
    }
}

class ApiException(val code: Int, message: String) : Exception(message)

private val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
})

private val trustAllSslContext: SSLContext by lazy {
    SSLContext.getInstance("TLS").apply {
        init(null, trustAllCerts, SecureRandom())
    }
}
