package dev.convocados.data.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class ConvocadosFcmService : FirebaseMessagingService() {

    @Inject lateinit var pushTokenManager: PushTokenManager

    override fun onNewToken(token: String) {
        Log.d("FCM", "New token: ${token.take(20)}...")
        pushTokenManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Firebase automatically shows the notification if the app is in background
        // and the message has a "notification" payload. For data-only messages,
        // we could build a custom notification here. For now, FCM handles it.
        Log.d("FCM", "Message received: ${message.data}")
    }
}
