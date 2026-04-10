package dev.convocados.data.api

import dev.convocados.data.auth.TokenStore
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
class ApiClient @Inject constructor(private val tokenStore: TokenStore) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
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
}

class ApiException(val code: Int, message: String) : Exception(message)
