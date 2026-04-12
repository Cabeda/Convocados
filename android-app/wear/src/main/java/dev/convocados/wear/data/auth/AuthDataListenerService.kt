package dev.convocados.wear.data.auth

import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Listens for auth token updates pushed from the phone app via the
 * Wearable Data Layer API. The phone app writes tokens to /auth path
 * and this service picks them up automatically.
 */
@AndroidEntryPoint
class AuthDataListenerService : WearableListenerService() {

    @Inject
    lateinit var tokenStore: WearTokenStore

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED && event.dataItem.uri.path == "/auth") {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val accessToken = dataMap.getString("access_token", "")
                val refreshToken = dataMap.getString("refresh_token", "")
                val expiresAt = dataMap.getLong("expires_at", 0)
                val serverUrl = dataMap.getString("server_url", "")

                if (accessToken.isNotEmpty() && refreshToken.isNotEmpty()) {
                    tokenStore.setTokens(OAuthTokens(accessToken, refreshToken, expiresAt))
                    if (serverUrl.isNotEmpty()) {
                        tokenStore.setServerUrl(serverUrl)
                    }
                    Log.d("AuthDataListener", "Tokens synced from phone")
                }
            } else if (event.type == DataEvent.TYPE_DELETED && event.dataItem.uri.path == "/auth") {
                tokenStore.clearTokens()
                Log.d("AuthDataListener", "Tokens cleared (phone logged out)")
            }
        }
    }
}
