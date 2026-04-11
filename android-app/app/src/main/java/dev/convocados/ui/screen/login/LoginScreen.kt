package dev.convocados.ui.screen.login

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.TokenStore
import dev.convocados.ui.theme.*
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(
    val authManager: AuthManager,
    private val tokenStore: TokenStore,
) : ViewModel() {
    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)
}

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    var showServerSettings by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }

    Box(
        modifier = Modifier.fillMaxSize().background(Bg),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Text("Convocados", color = Primary, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(8.dp))
            Text("Manage your games on the go", color = TextMuted, fontSize = 14.sp)
            Spacer(Modifier.height(48.dp))
            Button(
                onClick = { viewModel.authManager.startLogin(context as Activity) },
                colors = ButtonDefaults.buttonColors(containerColor = Primary),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.medium,
            ) {
                Text("Sign in", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }

            Spacer(Modifier.height(24.dp))

            // Server settings toggle
            TextButton(onClick = {
                serverUrl = viewModel.getServerUrl()
                showServerSettings = !showServerSettings
            }) {
                Text("Server URL", color = TextMuted, fontSize = 13.sp)
            }

            if (showServerSettings) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    placeholder = { Text("https://convocados.fly.dev") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                        focusedBorderColor = Primary, unfocusedBorderColor = Border,
                        cursorColor = Primary,
                        focusedContainerColor = SurfaceHover, unfocusedContainerColor = SurfaceHover,
                        focusedPlaceholderColor = TextMuted, unfocusedPlaceholderColor = TextMuted,
                    ),
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { showServerSettings = false }) {
                        Text("Cancel", color = TextMuted)
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            viewModel.setServerUrl(serverUrl.trim().trimEnd('/'))
                            showServerSettings = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryDark),
                    ) {
                        Text("Save", color = PrimaryContainer, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
