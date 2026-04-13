package dev.convocados.wear.ui.screen.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
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
                    val passwordFocusRequester = remember { FocusRequester() }

                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
                        Text(
                            text = "Email Sign In",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(4.dp))
                        
                        BasicTextField(
                            value = uiState.email,
                            onValueChange = { viewModel.onEmailChanged(it) },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    color = MaterialTheme.colorScheme.surfaceContainer,
                                    shape = RoundedCornerShape(20.dp)
                                )
                                .padding(vertical = 10.dp, horizontal = 12.dp),
                            textStyle = MaterialTheme.typography.labelMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface,
                                textAlign = TextAlign.Start
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                capitalization = KeyboardCapitalization.None,
                                autoCorrectEnabled = false,
                                imeAction = ImeAction.Next,
                            ),
                            keyboardActions = KeyboardActions(
                                onNext = { passwordFocusRequester.requestFocus() }
                            ),
                            decorationBox = { innerTextField ->
                                if (uiState.email.isEmpty()) {
                                    Text(
                                        text = "Email",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                                    )
                                }
                                innerTextField()
                            }
                        )
                        
                        Spacer(Modifier.height(8.dp))
                        
                        BasicTextField(
                            value = uiState.password,
                            onValueChange = { viewModel.onPasswordChanged(it) },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(passwordFocusRequester)
                                .background(
                                    color = MaterialTheme.colorScheme.surfaceContainer,
                                    shape = RoundedCornerShape(20.dp)
                                )
                                .padding(vertical = 10.dp, horizontal = 12.dp),
                            textStyle = MaterialTheme.typography.labelMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface,
                                textAlign = TextAlign.Start
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Go,
                            ),
                            keyboardActions = KeyboardActions(
                                onGo = { viewModel.loginWithEmail() },
                                onDone = { viewModel.loginWithEmail() },
                                onSend = { viewModel.loginWithEmail() },
                            ),
                            decorationBox = { innerTextField ->
                                if (uiState.password.isEmpty()) {
                                    Text(
                                        text = "Password",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                                    )
                                }
                                innerTextField()
                            }
                        )
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
