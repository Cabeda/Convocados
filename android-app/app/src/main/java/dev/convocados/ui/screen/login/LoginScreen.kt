package dev.convocados.ui.screen.login

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.GetCredentialException
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.auth.AuthManager
import dev.convocados.data.auth.AuthResult
import dev.convocados.data.auth.TokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// ── ViewModel ────────────────────────────────────────────────────────────────

enum class LoginMode { SIGN_IN, SIGN_UP, MAGIC_LINK }

data class LoginUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val message: String? = null, // success messages (verification needed, magic link sent)
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    val authManager: AuthManager,
    private val tokenStore: TokenStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState

    fun getServerUrl() = tokenStore.getServerUrl()
    fun setServerUrl(url: String) = tokenStore.setServerUrl(url)

    fun signInWithGoogle(credentialManager: CredentialManager, activity: android.app.Activity) {
        viewModelScope.launch {
            _uiState.value = LoginUiState(isLoading = true)
            try {
                val request = authManager.buildGoogleSignInRequest()
                val response = credentialManager.getCredential(activity, request)
                val result = authManager.handleGoogleCredential(response)
                handleResult(result)
            } catch (e: GetCredentialException) {
                handleResult(authManager.handleCredentialError(e))
            } catch (e: Exception) {
                handleResult(AuthResult.Error(e.message ?: "Google sign-in failed"))
            }
        }
    }

    fun signInWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = LoginUiState(isLoading = true)
            val result = authManager.signInWithEmail(email, password)
            handleResult(result)
        }
    }

    fun signUpWithEmail(name: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = LoginUiState(isLoading = true)
            val result = authManager.signUpWithEmail(name, email, password)
            handleResult(result)
        }
    }

    fun sendMagicLink(email: String) {
        viewModelScope.launch {
            _uiState.value = LoginUiState(isLoading = true)
            val result = authManager.sendMagicLink(email)
            handleResult(result)
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun clearMessage() {
        _uiState.value = _uiState.value.copy(message = null)
    }

    private fun handleResult(result: AuthResult) {
        _uiState.value = when (result) {
            is AuthResult.Success -> LoginUiState() // isAuthenticated flow will navigate away
            is AuthResult.NeedsVerification -> LoginUiState(message = result.message)
            is AuthResult.MagicLinkSent -> LoginUiState(message = result.message)
            is AuthResult.Error -> LoginUiState(error = result.message)
            is AuthResult.Cancelled -> LoginUiState()
        }
    }
}

// ── Composable ───────────────────────────────────────────────────────────────

@Composable
fun LoginScreen(
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val activity = context as android.app.Activity
    val credentialManager = remember { CredentialManager.create(context) }
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var mode by remember { mutableStateOf(LoginMode.SIGN_IN) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var showServerSettings by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .padding(32.dp)
                .verticalScroll(rememberScrollState())
                .widthIn(max = 400.dp),
        ) {
            // Header
            Text(
                "Convocados",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.manage_games),
                color = MaterialTheme.colorScheme.outline,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(40.dp))

            // ── Google Sign-In Button ────────────────────────────────────
            Button(
                onClick = { viewModel.signInWithGoogle(credentialManager, activity) },
                enabled = !uiState.isLoading,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.medium,
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 2.dp),
            ) {
                Text(
                    stringResource(R.string.sign_in_with_google),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                )
            }

            Spacer(Modifier.height(24.dp))

            // ── Divider ──────────────────────────────────────────────────
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                HorizontalDivider(modifier = Modifier.weight(1f))
                Text(
                    "  or  ",
                    color = MaterialTheme.colorScheme.outline,
                    style = MaterialTheme.typography.bodySmall,
                )
                HorizontalDivider(modifier = Modifier.weight(1f))
            }

            Spacer(Modifier.height(24.dp))

            // ── Mode Tabs ────────────────────────────────────────────────
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                FilterChip(
                    selected = mode == LoginMode.SIGN_IN,
                    onClick = { mode = LoginMode.SIGN_IN; viewModel.clearError(); viewModel.clearMessage() },
                    label = { Text(stringResource(R.string.sign_in)) },
                )
                Spacer(Modifier.width(8.dp))
                FilterChip(
                    selected = mode == LoginMode.SIGN_UP,
                    onClick = { mode = LoginMode.SIGN_UP; viewModel.clearError(); viewModel.clearMessage() },
                    label = { Text(stringResource(R.string.sign_up)) },
                )
                Spacer(Modifier.width(8.dp))
                FilterChip(
                    selected = mode == LoginMode.MAGIC_LINK,
                    onClick = { mode = LoginMode.MAGIC_LINK; viewModel.clearError(); viewModel.clearMessage() },
                    label = { Text(stringResource(R.string.magic_link)) },
                )
            }

            Spacer(Modifier.height(20.dp))

            // ── Name field (sign-up only) ────────────────────────────────
            AnimatedVisibility(visible = mode == LoginMode.SIGN_UP) {
                Column {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text(stringResource(R.string.name)) },
                        leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }

            // ── Email field ──────────────────────────────────────────────
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text(stringResource(R.string.email)) },
                leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = if (mode == LoginMode.MAGIC_LINK) ImeAction.Done else ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                    onDone = {
                        if (mode == LoginMode.MAGIC_LINK) {
                            focusManager.clearFocus()
                            viewModel.sendMagicLink(email.trim())
                        }
                    },
                ),
            )

            // ── Password field (sign-in and sign-up) ─────────────────────
            AnimatedVisibility(visible = mode != LoginMode.MAGIC_LINK) {
                Column {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(stringResource(R.string.password)) },
                        leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = null,
                                )
                            }
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = {
                            focusManager.clearFocus()
                            when (mode) {
                                LoginMode.SIGN_IN -> viewModel.signInWithEmail(email.trim(), password)
                                LoginMode.SIGN_UP -> viewModel.signUpWithEmail(name.trim(), email.trim(), password)
                                else -> {}
                            }
                        }),
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            // ── Action Button ────────────────────────────────────────────
            Button(
                onClick = {
                    focusManager.clearFocus()
                    when (mode) {
                        LoginMode.SIGN_IN -> viewModel.signInWithEmail(email.trim(), password)
                        LoginMode.SIGN_UP -> viewModel.signUpWithEmail(name.trim(), email.trim(), password)
                        LoginMode.MAGIC_LINK -> viewModel.sendMagicLink(email.trim())
                    }
                },
                enabled = !uiState.isLoading && email.isNotBlank() &&
                    (mode == LoginMode.MAGIC_LINK || password.isNotBlank()) &&
                    (mode != LoginMode.SIGN_UP || name.isNotBlank()),
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.medium,
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(
                        when (mode) {
                            LoginMode.SIGN_IN -> stringResource(R.string.sign_in)
                            LoginMode.SIGN_UP -> stringResource(R.string.sign_up)
                            LoginMode.MAGIC_LINK -> stringResource(R.string.send_magic_link)
                        },
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }

            // ── Error / Success messages ─────────────────────────────────
            uiState.error?.let { error ->
                Spacer(Modifier.height(12.dp))
                Text(
                    error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            uiState.message?.let { message ->
                Spacer(Modifier.height(12.dp))
                Text(
                    message,
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // ── Server settings ──────────────────────────────────────────
            Spacer(Modifier.height(32.dp))
            TextButton(onClick = {
                serverUrl = viewModel.getServerUrl()
                showServerSettings = !showServerSettings
            }) {
                Text(
                    stringResource(R.string.server_url),
                    color = MaterialTheme.colorScheme.outline,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            AnimatedVisibility(visible = showServerSettings) {
                Column {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it },
                        placeholder = { Text("https://convocados.cabeda.dev") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = { showServerSettings = false }) {
                            Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline)
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = {
                                viewModel.setServerUrl(serverUrl.trim().trimEnd('/'))
                                showServerSettings = false
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                        ) {
                            Text(
                                stringResource(R.string.save),
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}
