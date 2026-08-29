package dev.convocados.ui.fixture

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Basic semantics contract for the deterministic review surfaces. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class FixtureAccessibilityTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun gamesExposeActionableCardsAndCreateAction() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                GamesFixtureContent(FixtureData.games, {}, {})
            }
        }

        composeRule.onNodeWithText("Tuesday Football").assertHasClickAction()
        composeRule.onNodeWithContentDescription("Create game").assertHasClickAction()
    }

    @Test
    fun adaptiveListDetailKeepsBothSurfacesActionable() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                AdaptiveGamesFixtureContent(FixtureData.games, FixtureData.event, {}, {}, {}, {})
            }
        }

        composeRule.onNodeWithContentDescription("Create game").assertHasClickAction()
        composeRule.onNodeWithText("View game").assertHasClickAction()
    }

    @Test
    fun eventExposesPrimaryAction() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                EventFixtureContent(FixtureData.event, {}, {})
            }
        }

        composeRule.onNodeWithText("View game").assertHasClickAction()
    }

    @Test
    fun `state fixtures communicate payment and offline states without color`() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                EventStateFixtureContent(FixtureState.Payment)
            }
        }

        composeRule.onNodeWithText("Payment due").assertExists()
        composeRule.onNodeWithText("Offline cached").assertDoesNotExist()
    }

    @Test
    fun urgent_fixture_communicates_time_sensitive_state() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                EventStateFixtureContent(FixtureState.Urgent)
            }
        }

        composeRule.onNodeWithText("Starting soon").assertExists()
        composeRule.onNodeWithText("The game starts in less than two hours.").assertExists()
    }

    @Test
    fun offline_fixture_communicates_cached_state() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                EventStateFixtureContent(FixtureState.Offline)
            }
        }

        composeRule.onNodeWithText("Offline cached").assertExists()
    }
}
