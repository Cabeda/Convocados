package dev.convocados.wear.ui.screen.auth

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import dev.convocados.wear.BuildConfig
import dev.convocados.wear.R
import dev.convocados.wear.ui.theme.TextMuted
import kotlinx.coroutines.launch

/**
 * Auth screen with prominent Google Sign-In button.
 * In debug builds, also shows email/password sign-in for local dev.
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
    val listState = rememberScalingLazyListState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onAuthenticated()
    }

    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(
            top = 32.dp,
            bottom = 16.dp,
            start = 16.dp,
            end = 16.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // App title
        item {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.title2,
                color = MaterialTheme.colors.primary,
            )
        }

        // Primary: Google Sign-In
        item {
            if (uiState.isSigningIn) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.signing_in),
                        style = MaterialTheme.typography.caption3,
                        color = MaterialTheme.colors.onSurfaceVariant,
                    )
                }
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
                            text = stringResource(R.string.sign_in_google),
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
        }

        // Error message
        if (uiState.error != null) {
            item {
                Text(
                    text = uiState.error!!,
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.error,
                    textAlign = TextAlign.Center,
                )
            }
        }

        // Backend selector — always visible
        item { BackendSelector(viewModel) }

        // Dev-only: email/password sign-in
        if (BuildConfig.DEBUG) {
            item { EmailSignIn(viewModel) }
        }
    }
}

/**
 * Lets the user toggle between the production backend and localhost.
 */
@Composable
private fun BackendSelector(viewModel: AuthViewModel) {
    var expanded by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf(viewModel.getServerUrl()) }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        CompactChip(
            onClick = { expanded = !expanded },
            label = {
                Text(
                    text = stringResource(R.string.server_settings),
                    style = MaterialTheme.typography.caption3,
                )
            },
            colors = ChipDefaults.secondaryChipColors(),
        )

        if (expanded) {
            Spacer(modifier = Modifier.height(4.dp))
            val isLocal = serverUrl.contains("10.0.2.2") || serverUrl.contains("localhost")
            CompactChip(
                onClick = {
                    val newUrl = if (isLocal) "https://convocados.fly.dev" else "http://10.0.2.2:4321"
                    serverUrl = newUrl
                    viewModel.setServerUrl(newUrl)
                },
                label = {
                    Text(
                        text = stringResource(if (isLocal) R.string.set_to_prod else R.string.set_to_local),
                        style = MaterialTheme.typography.caption3,
                    )
                },
                colors = ChipDefaults.primaryChipColors(),
            )
            Text(
                text = serverUrl,
                style = MaterialTheme.typography.caption3,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Email/password sign-in for local dev.
 * Uses the same mobile-callback OAuth flow as the phone app.
 */
@Composable
private fun EmailSignIn(viewModel: AuthViewModel) {
    var email by remember { mutableStateOf("test@example.com") }
    var password by remember { mutableStateOf("TestPassword123") }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = "Dev Sign-In",
            style = MaterialTheme.typography.caption1,
            color = MaterialTheme.colors.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(4.dp))

        CompactChip(
            onClick = { viewModel.signInWithEmail(email, password) },
            label = {
                Text(
                    text = "Sign in ($email)",
                    style = MaterialTheme.typography.caption3,
                )
            },
            colors = ChipDefaults.secondaryChipColors(),
        )
    }
}
