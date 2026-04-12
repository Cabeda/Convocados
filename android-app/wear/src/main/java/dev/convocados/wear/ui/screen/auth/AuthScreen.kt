package dev.convocados.wear.ui.screen.auth

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.material.*
import dev.convocados.wear.ui.theme.TextMuted
import kotlinx.coroutines.launch

/**
 * Auth screen with prominent Google Sign-In button.
 * Also supports passive token sync from the phone app via Data Layer.
 */
@Composable
fun AuthScreen(
    onAuthenticated: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onAuthenticated()
    }

    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            // App title
            Text(
                text = "Convocados",
                style = MaterialTheme.typography.title2,
                color = MaterialTheme.colors.primary,
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Primary: Google Sign-In button
            if (uiState.isSigningIn) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Signing in...",
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.onSurfaceVariant,
                )
            } else {
                Chip(
                    onClick = {
                        scope.launch {
                            try {
                                val credentialManager = CredentialManager.create(context)
                                val request = viewModel.getGoogleSignInRequest()
                                val result = credentialManager.getCredential(
                                    context = context,
                                    request = request,
                                )
                                viewModel.handleGoogleSignInResult(result)
                            } catch (e: Exception) {
                                viewModel.handleGoogleSignInError(e)
                            }
                        }
                    },
                    label = {
                        Text(
                            text = "Sign in with Google",
                            style = MaterialTheme.typography.button,
                        )
                    },
                    colors = ChipDefaults.chipColors(
                        backgroundColor = MaterialTheme.colors.primary,
                        contentColor = MaterialTheme.colors.onPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Error message
            uiState.error?.let { error ->
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = error,
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.error,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Secondary: phone sync hint
            Text(
                text = "or sign in on phone",
                style = MaterialTheme.typography.caption3,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}
