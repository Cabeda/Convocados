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
        val response = client.post("$baseUrl/api/auth/oauth2/token") {
            contentType(ContentType.Application.FormUrlEncoded)
            setBody("grant_type=refresh_token&refresh_token=${tokens.refreshToken}&client_id=mobile-app")
        }
        if (!response.status.isSuccess()) {
            tokenStore.clearTokens()
            throw ApiException(401, "Session expired")
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
     * Exchange a Google ID token for Convocados OAuth tokens (unauthenticated).
     * Uses better-auth's built-in social sign-in callback endpoint, which is
     * already configured with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the backend.
     */
    suspend fun exchangeGoogleToken(idToken: String): OAuthTokenResponse {
        val response = client.post("$baseUrl/api/auth/callback/google") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("idToken" to idToken, "callbackURL" to "/"))
        }
        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiException(response.status.value, "Google token exchange failed: $errorBody")
        }
        return response.body()
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

        // Step 2: GET mobile-callback to get a one-time code
        val callbackResponse = client.get("$baseUrl/api/auth/mobile-callback") {
            header("Cookie", cookies)
            parameter("redirect_uri", "convocados://auth")
        }

        val redirectLocation = callbackResponse.headers["Location"]
            ?: throw ApiException(400, "No redirect from mobile-callback")

        val code = redirectLocation.substringAfter("code=").substringBefore("&")
        if (code.isBlank()) throw ApiException(400, "No code in redirect: $redirectLocation")

        // Step 3: Exchange code for OAuth tokens
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
