package dev.convocados.wear.ui.screen.teams

import android.view.View
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.ui.screen.settings.GameSettingsUiState
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w200dp-h200dp")
class AddPlayerScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `add player honors the loaded event keep screen setting`() {
        val settings = MutableStateFlow(GameSettingsUiState(isLoading = true, keepScreenOn = true))
        val addPlayerViewModel = mockk<AddPlayerViewModel>(relaxed = true)
        val settingsViewModel = mockk<dev.convocados.wear.ui.screen.settings.GameSettingsViewModel>(relaxed = true)
        every { addPlayerViewModel.uiState } returns MutableStateFlow(AddPlayerUiState(isLoading = false))
        every { settingsViewModel.uiState } returns settings
        lateinit var view: View

        composeRule.setContent {
            ConvocadosWearTheme {
                view = LocalView.current
                AddPlayerScreen(
                    eventId = "event-1",
                    viewModel = addPlayerViewModel,
                    settingsViewModel = settingsViewModel,
                )
            }
        }
        composeRule.waitForIdle()
        assertFalse(view.keepScreenOn)

        settings.value = GameSettingsUiState(isLoading = false, keepScreenOn = true)
        composeRule.waitForIdle()
        assertTrue(view.keepScreenOn)

        settings.value = GameSettingsUiState(isLoading = false, keepScreenOn = false)
        composeRule.waitForIdle()
        assertFalse(view.keepScreenOn)
    }

    @Test
    fun `add player restores the host view flag when it leaves`() {
        val settings = MutableStateFlow(GameSettingsUiState(isLoading = false, keepScreenOn = true))
        val showScreen = mutableStateOf(true)
        val addPlayerViewModel = mockk<AddPlayerViewModel>(relaxed = true)
        val settingsViewModel = mockk<dev.convocados.wear.ui.screen.settings.GameSettingsViewModel>(relaxed = true)
        every { addPlayerViewModel.uiState } returns MutableStateFlow(AddPlayerUiState(isLoading = false))
        every { settingsViewModel.uiState } returns settings
        lateinit var view: View

        composeRule.setContent {
            ConvocadosWearTheme {
                view = LocalView.current
                if (showScreen.value) {
                    AddPlayerScreen(
                        eventId = "event-1",
                        viewModel = addPlayerViewModel,
                        settingsViewModel = settingsViewModel,
                    )
                }
            }
        }
        composeRule.waitForIdle()
        assertTrue(view.keepScreenOn)

        showScreen.value = false
        composeRule.waitForIdle()
        assertFalse(view.keepScreenOn)
    }
}
