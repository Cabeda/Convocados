package dev.convocados.wear.ui.screen.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.ui.theme.TextMuted
import kotlinx.coroutines.launch

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun AuthScreen(
    onAuthenticated: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isAuthenticated by viewModel.isAuthenticated.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val columnState = rememberColumnState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) onAuthenticated()
    }

    ScreenScaffold(scrollState = columnState) {
        ScalingLazyColumn(
            columnState = columnState,
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                Text(
                    text = "Convocados",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }

            if (uiState.showEmailLogin) {
                // --- Email Login Form ---
                item {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
                        Text(
                            text = "Email Sign In",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(4.dp))
                        
                        // Note: Material3 Wear doesn't have a standard TextField yet, 
                        // so we use the basic one or a custom wrapper if available.
                        // For simplicity in this UI, we'll use a Button that triggers 
                        // remote input or a simplified layout.
                        
                        OutlinedButton(
                            onClick = { /* In a real app, trigger RemoteInput or a keyboard screen */ },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(uiState.email.ifBlank { "Enter Email" }, maxLines = 1)
                        }
                        
                        Spacer(Modifier.height(4.dp))
                        
                        OutlinedButton(
                            onClick = { /* Trigger keyboard */ },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Enter Password", maxLines = 1)
                        }
                    }
                }

                item {
                    Button(
                        onClick = { viewModel.loginWithEmail() },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        enabled = !uiState.isSigningIn
                    ) {
                        Text("Sign In")
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
                    if (uiState.isSigningIn) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    } else {
                        Button(
                            onClick = {
                                scope.launch {
                                    try {
                                        val credentialManager = CredentialManager.create(context)
                                        val request = viewModel.getGoogleSignInRequest()
                                        val result = credentialManager.getCredential(context, request)
                                        viewModel.handleGoogleSignInResult(result)
                                    } catch (e: Exception) {
                                        viewModel.handleGoogleSignInError(e)
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Sign in with Google") }
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
                Text(
                    text = "or sign in on phone",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 20.dp)
                )
            }
        }
    }
}
