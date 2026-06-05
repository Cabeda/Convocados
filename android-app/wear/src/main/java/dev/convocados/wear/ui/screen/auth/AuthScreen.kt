package dev.convocados.wear.ui.screen.auth

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.material3.*
import androidx.wear.input.RemoteInputIntentHelper
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.BuildConfig
import dev.convocados.wear.R
import dev.convocados.wear.ui.theme.TextMuted

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun AuthScreen(
    onAuthenticated: () -> Unit,
    onQuickGame: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onAuthenticated()
    }

    // Dev-only: prefill credentials from .env.wear
    val devEmail = if (BuildConfig.DEBUG) BuildConfig.WEAR_DEV_EMAIL else ""
    val devPassword = if (BuildConfig.DEBUG) BuildConfig.WEAR_DEV_PASSWORD else ""
    val hasDevCreds = devEmail.isNotBlank() && devPassword.isNotBlank()

    ScreenScaffold(scrollState = columnState) {
        ScalingLazyColumn(
            columnState = columnState,
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                Text(
                    text = stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }

            if (uiState.showEmailLogin) {
                // --- Email Login Form (using Wear OS RemoteInput) ---
                item {
                    val emailLauncher = rememberLauncherForActivityResult(
                        ActivityResultContracts.StartActivityForResult()
                    ) { result ->
                        result.data?.let { data ->
                            val results = RemoteInput.getResultsFromIntent(data)
                            results?.getCharSequence("email")?.toString()?.let {
                                viewModel.onEmailChanged(it)
                            }
                        }
                    }

                    val passwordLauncher = rememberLauncherForActivityResult(
                        ActivityResultContracts.StartActivityForResult()
                    ) { result ->
                        result.data?.let { data ->
                            val results = RemoteInput.getResultsFromIntent(data)
                            results?.getCharSequence("password")?.toString()?.let {
                                viewModel.onPasswordChanged(it)
                            }
                        }
                    }

                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
                        // Email input button
                        Button(
                            onClick = {
                                val remoteInput = RemoteInput.Builder("email")
                                    .setLabel("Email")
                                    .build()
                                val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
                                RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(remoteInput))
                                intent.putExtra("android.text.InputType", android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
                                emailLauncher.launch(intent)
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.filledTonalButtonColors(),
                        ) {
                            Text(
                                text = uiState.email.ifBlank { "Email" },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }

                        Spacer(Modifier.height(6.dp))

                        // Password input button
                        Button(
                            onClick = {
                                val remoteInput = RemoteInput.Builder("password")
                                    .setLabel("Password")
                                    .build()
                                val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
                                RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(remoteInput))
                                intent.putExtra("android.text.InputType", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD)
                                passwordLauncher.launch(intent)
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.filledTonalButtonColors(),
                        ) {
                            Text(
                                text = if (uiState.password.isBlank()) "Password" else "••••••••",
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                }

                item {
                    Button(
                        onClick = { viewModel.loginWithEmail() },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        enabled = !uiState.isSigningIn
                    ) {
                        Text(stringResource(R.string.sign_in_email))
                    }
                }

                // Dev-only: one-tap login with pre-filled credentials
                if (hasDevCreds) {
                    item {
                        CompactButton(
                            onClick = {
                                viewModel.onEmailChanged(devEmail)
                                viewModel.onPasswordChanged(devPassword)
                                viewModel.loginWithEmail()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = "Dev Login",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }

                item {
                    TextButton(onClick = { viewModel.toggleEmailLogin() }) {
                        Text("Back to Google", style = MaterialTheme.typography.labelSmall)
                    }
                }

            } else {
                // --- Primary Google Login ---
                item { Spacer(modifier = Modifier.height(8.dp)) }

                item {
                    val googleLauncher = rememberLauncherForActivityResult(
                        ActivityResultContracts.StartActivityForResult()
                    ) { result ->
                        viewModel.handleGoogleSignInResult(result.data)
                    }
                    if (uiState.isSigningIn) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    } else {
                        Button(
                            onClick = { googleLauncher.launch(viewModel.getSignInIntent()) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.sign_in_google)) }
                        )
                    }
                }

                item {
                    TextButton(
                        onClick = { viewModel.toggleEmailLogin() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Use Email/Password", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }

            uiState.error?.let { error ->
                item {
                    Text(
                        text = error,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp)
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                TextButton(onClick = onQuickGame) {
                    Text(
                        text = stringResource(R.string.quick_game),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }

            // Dev-only: backend selector
            if (BuildConfig.DEBUG) {
                item { BackendSelector(viewModel) }
            }
        }
    }
}

/**
 * Lets the user toggle between the production backend and localhost.
 * Only shown in debug builds.
 */
@Composable
private fun BackendSelector(viewModel: AuthViewModel) {
    var expanded by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf(viewModel.getServerUrl()) }
    val isLocal = serverUrl.contains("10.0.2.2") || serverUrl.contains("localhost")

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(bottom = 16.dp),
    ) {
        Button(
            onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.filledTonalButtonColors(),
        ) {
            Text(
                text = stringResource(R.string.server_settings),
                style = MaterialTheme.typography.labelSmall,
            )
        }

        if (expanded) {
            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = {
                    val newUrl = if (isLocal) "https://convocados.cabeda.dev" else "http://10.0.2.2:4321"
                    serverUrl = newUrl
                    viewModel.setServerUrl(newUrl)
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = stringResource(if (isLocal) R.string.set_to_prod else R.string.set_to_local),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = serverUrl,
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}