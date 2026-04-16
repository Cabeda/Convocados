package dev.convocados.wear.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.ui.navigation.WearNavigation
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import javax.inject.Inject

@AndroidEntryPoint
class WearActivity : ComponentActivity() {

    @Inject
    lateinit var tokenStore: WearTokenStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ConvocadosWearTheme {
                WearNavigation(tokenStore)
            }
        }
    }
}
