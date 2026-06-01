package dev.convocados

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.data.auth.OAuthTokens
import dev.convocados.data.auth.TokenStore
import dev.convocados.ui.ConvocadosRoot
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var tokenStore: TokenStore

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Dev: inject token via ADB: adb shell am start -n com.cabeda.convocados/dev.convocados.MainActivity --es token "ACCESS_TOKEN"
        intent.getStringExtra("token")?.let { token ->
            tokenStore.setTokens(OAuthTokens(accessToken = token, refreshToken = "", expiresAt = System.currentTimeMillis() + 3600_000))
        }

        setContent { ConvocadosRoot(deepLink = extractDeepLink(intent)) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun extractDeepLink(intent: Intent): String? {
        // From FCM notification tap
        intent.getStringExtra("deep_link")?.let { return it }
        // From app shortcuts
        intent.getStringExtra("navigate_to")?.let { return it }
        return null
    }
}
