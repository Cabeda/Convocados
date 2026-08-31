package dev.convocados.wear.data.auth

import dev.convocados.wear.data.api.OAuthTokenResponse
import dev.convocados.wear.data.api.WearApiClient
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import javax.inject.Inject
import javax.inject.Singleton

interface WearRestoreCredentialGateway {
    suspend fun fetchRegistrationOptions(): String
    suspend fun register(responseJson: String)
    suspend fun fetchAuthenticationOptions(): String
    suspend fun authenticate(responseJson: String): OAuthTokenResponse
}

/** Adapter for the Wear app's WebAuthn-compatible Restore Credential endpoints. */
@Singleton
class ApiWearRestoreCredentialGateway @Inject constructor(
    private val apiClient: WearApiClient,
) : WearRestoreCredentialGateway {
    override suspend fun fetchRegistrationOptions(): String =
        extractOptions(apiClient.postAuthenticatedRaw(REGISTRATION_OPTIONS_PATH))

    override suspend fun register(responseJson: String) {
        apiClient.postAuthenticatedRaw(
            REGISTRATION_PATH,
            mapOf("responseJson" to responseJson),
        )
    }

    override suspend fun fetchAuthenticationOptions(): String =
        extractOptions(apiClient.postUnauthenticatedRaw(AUTHENTICATION_OPTIONS_PATH))

    override suspend fun authenticate(responseJson: String): OAuthTokenResponse =
        Json.decodeFromString(
            apiClient.postUnauthenticatedRaw(
                AUTHENTICATE_PATH,
                mapOf("responseJson" to responseJson),
            ),
        )

    private companion object {
        const val REGISTRATION_OPTIONS_PATH = "/api/auth/restore-credentials/registration-options"
        const val REGISTRATION_PATH = "/api/auth/restore-credentials/register"
        const val AUTHENTICATION_OPTIONS_PATH = "/api/auth/restore-credentials/authentication-options"
        const val AUTHENTICATE_PATH = "/api/auth/restore-credentials/authenticate"

        fun extractOptions(raw: String): String {
            val element = Json.parseToJsonElement(raw)
            if (element is JsonObject) {
                element["requestJson"]?.let { return valueAsJson(it) }
                element["options"]?.let { return valueAsJson(it) }
            }
            return raw
        }

        fun valueAsJson(value: JsonElement): String =
            if (value is JsonPrimitive) value.contentOrNull ?: value.toString() else value.toString()
    }
}
