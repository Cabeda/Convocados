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
import javax.inject.Inject
import javax.inject.Singleton

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

    /** Exchange a Google ID token for Convocados OAuth tokens (unauthenticated). */
    suspend fun exchangeGoogleToken(idToken: String): OAuthTokenResponse {
        val response = client.post("$baseUrl/api/auth/google/callback") {
            contentType(ContentType.Application.Json)
            setBody(mapOf("idToken" to idToken, "clientId" to "mobile-app"))
        }
        if (!response.status.isSuccess()) {
            val errorBody = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiException(response.status.value, "Google token exchange failed: $errorBody")
        }
        return response.body()
    }
}

class ApiException(val code: Int, message: String) : Exception(message)
