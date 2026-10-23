package dev.convocados.wear.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.api.KnownPlayer
import dev.convocados.wear.data.api.MvpParticipant
import dev.convocados.wear.data.api.MvpResponse
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.ui.fixture.WearFixtures
import dev.convocados.wear.ui.fixture.WearGamesFixtureContent
import dev.convocados.wear.ui.fixture.WearHistoryFixtureContent
import dev.convocados.wear.ui.screen.mvp.MvpVotingScreen
import dev.convocados.wear.ui.screen.mvp.MvpVotingUiState
import dev.convocados.wear.ui.screen.mvp.MvpVotingViewModel
import dev.convocados.wear.ui.screen.quick.QuickSetupScreen
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.screen.quick.SaveQuickGameContent
import dev.convocados.wear.ui.screen.settings.GameSettingsUiState
import dev.convocados.wear.ui.screen.settings.GameSettingsViewModel
import dev.convocados.wear.ui.screen.teams.AddPlayerScreen
import dev.convocados.wear.ui.screen.teams.AddPlayerUiState
import dev.convocados.wear.ui.screen.teams.AddPlayerViewModel
import dev.convocados.wear.ui.screen.teams.TeamsScreen
import dev.convocados.wear.ui.screen.teams.TeamsUiState
import dev.convocados.wear.ui.screen.teams.TeamsViewModel
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every control a user is meant to tap has to be a real target on a Wear
 * display, not a 32dp pill under a fingertip.
 *
 * `CompactButton` — used across these screens for Quick Game, History, the
 * sport picker, the +/- steppers, Add player and Done — is 32dp tall and can
 * be as narrow as 33dp. Wear's guidance is 48dp in both dimensions, and a
 * watch is operated with a moving fingertip, so the floor is not advisory.
 *
 * Asserted on a round, a square and a small-round display, because the round
 * inset narrows rows further and the square layout is where a fix that only
 * pads the round branch would be invisible.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WearTouchTargetTest {

    @get:Rule
    val composeRule = createComposeRule()

    // ── games ───────────────────────────────────────────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round games list touch targets are at least 48dp`() {
        renderGames()
        assertAllTouchTargetsMeetMinimum("round games list")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square games list touch targets are at least 48dp`() {
        renderGames()
        assertAllTouchTargetsMeetMinimum("square games list")
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun `small round games list touch targets are at least 48dp`() {
        renderGames()
        assertAllTouchTargetsMeetMinimum("small round games list")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round history list touch targets are at least 48dp`() {
        composeRule.setContent {
            ConvocadosWearTheme {
                WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)
            }
        }
        assertAllTouchTargetsMeetMinimum("round history list")
    }

    // ── quick setup ─────────────────────────────────────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round quick setup touch targets are at least 48dp`() {
        renderQuickSetup()
        expandVibrationAlerts()
        assertAllTouchTargetsMeetMinimum("round quick setup")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square quick setup touch targets are at least 48dp`() {
        renderQuickSetup()
        expandVibrationAlerts()
        assertAllTouchTargetsMeetMinimum("square quick setup")
    }

    // ── teams ───────────────────────────────────────────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round teams touch targets are at least 48dp`() {
        renderTeams()
        expandVibrationAlerts()
        assertAllTouchTargetsMeetMinimum("round teams")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square teams touch targets are at least 48dp`() {
        renderTeams()
        expandVibrationAlerts()
        assertAllTouchTargetsMeetMinimum("square teams")
    }

    // ── the rest ────────────────────────────────────────────────────────

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round quick save touch targets are at least 48dp`() {
        composeRule.setContent {
            ConvocadosWearTheme { SaveQuickGameContent(state = WearFixtures.quickSave) }
        }
        assertAllTouchTargetsMeetMinimum("round quick save")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round mvp voting touch targets are at least 48dp`() {
        renderMvp()
        assertAllTouchTargetsMeetMinimum("round mvp voting")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round add player touch targets are at least 48dp`() {
        renderAddPlayer()
        assertAllTouchTargetsMeetMinimum("round add player")
    }

    // ── score screen ────────────────────────────────────────────────────
    // The Finish control is one of the two ways a game ends (#1360), and it
    // sat at 32dp under a fingertip until #1361. Asserted on all three shapes
    // because the top padding that clears the progress marker is round
    // reasoning, and the square branch is where such a fix goes quiet.

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round score finish touch target is at least 48dp`() {
        renderScore()
        assertAllTouchTargetsMeetMinimum("round score")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square score finish touch target is at least 48dp`() {
        renderScore()
        assertAllTouchTargetsMeetMinimum("square score")
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun `small round score finish touch target is at least 48dp`() {
        renderScore()
        assertAllTouchTargetsMeetMinimum("small round score")
    }

    private fun renderScore() {
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreFixtureContent(
                    state = WearFixtures.liveScore,
                    now = WearFixtures.now,
                )
            }
        }
        composeRule.waitForIdle()
    }

    // ── assertions ──────────────────────────────────────────────────────

    private fun assertAllTouchTargetsMeetMinimum(context: String) {
        composeRule.waitForIdle()
        val targets = interactiveTargets()
        assertTrue("$context rendered no interactive nodes, so nothing was measured", targets.isNotEmpty())
        val density = composeRule.density
        val floor = with(density) { MIN_TOUCH_TARGET.toPx() }
        val tolerance = 0.5f
        targets.forEach { node ->
            // Layout size, not boundsInRoot: TransformingLazyColumn scales the
            // items nearest the bezel through a graphicsLayer, so a row that is
            // laid out at 52dp reads as 32dp at the bottom of the viewport. The
            // laid-out size is what the row occupies once scrolled to the
            // equator, where the user actually taps it.
            val widthDp = with(density) { node.size.width.toDp() }
            val heightDp = with(density) { node.size.height.toDp() }
            assertTrue(
                ("%s: %s is laid out %.1fdp x %.1fdp, expected at least %.1fdp in both dimensions")
                    .format(context, describe(node), widthDp.value, heightDp.value, MIN_TOUCH_TARGET.value),
                node.size.width >= floor - tolerance && node.size.height >= floor - tolerance,
            )
        }
    }

    /** Every node the user can act on, scroll containers excluded. */
    private fun interactiveTargets(): List<SemanticsNode> =
        composeRule.onAllNodes(
            (hasClickAction() or onLongClick() or isToggleable())
                .and(hasScrollAction().not()),
            useUnmergedTree = true,
        ).fetchSemanticsNodes()

    private fun onLongClick(): SemanticsMatcher =
        SemanticsMatcher.keyIsDefined(SemanticsActions.OnLongClick)

    private fun describe(node: SemanticsNode): String {
        val desc: Any? = node.config.getOrNull(SemanticsProperties.ContentDescription)
        val text: Any? = node.config.getOrNull(SemanticsProperties.Text)
        val label = listOfNotNull(desc?.toString(), text?.toString()).joinToString(" / ")
        return label.ifBlank { "unnamed control" }
    }

    // ── rendering ───────────────────────────────────────────────────────

    private fun renderGames() {
        composeRule.setContent {
            ConvocadosWearTheme {
                WearGamesFixtureContent(
                    games = WearFixtures.games,
                    pendingSyncCount = 1,
                    now = WearFixtures.now,
                )
            }
        }
        composeRule.waitForIdle()
    }

    private fun renderQuickSetup() {
        composeRule.setContent {
            ConvocadosWearTheme { QuickSetupScreen(onStart = { _, _, _ -> }) }
        }
        composeRule.waitForIdle()
    }

    private fun renderTeams() {
        val teamsViewModel = mockk<TeamsViewModel>(relaxed = true)
        every { teamsViewModel.uiState } returns MutableStateFlow(
            TeamsUiState(
                teamOnePlayers = listOf(player("p1", "teamOne", 0, "Ana Filipa Rodrigues")),
                unassigned = listOf(player("u1", "unassigned", 0, "Carlos Eduardo Ferreira")),
                isLoading = false,
            ),
        )
        val settingsViewModel = mockk<GameSettingsViewModel>(relaxed = true)
        every { settingsViewModel.uiState } returns
            MutableStateFlow(GameSettingsUiState(isLoading = false, canScheduleExact = true))

        composeRule.setContent {
            ConvocadosWearTheme {
                TeamsScreen(
                    eventId = "event-1",
                    viewModel = teamsViewModel,
                    settingsViewModel = settingsViewModel,
                )
            }
        }
        composeRule.waitForIdle()
    }

    private fun renderMvp() {
        val viewModel = mockk<MvpVotingViewModel>(relaxed = true)
        every { viewModel.uiState } returns MutableStateFlow(
            MvpVotingUiState(
                isLoading = false,
                response = MvpResponse(
                    isVotingOpen = true,
                    hasVoted = false,
                    participants = listOf(
                        MvpParticipant("p1", "Ana Filipa Rodrigues", 2),
                        MvpParticipant("p2", "Carlos Eduardo Ferreira", 1),
                    ),
                ),
            ),
        )
        composeRule.setContent {
            ConvocadosWearTheme { MvpVotingScreen(viewModel = viewModel, eventId = "e1", historyId = "h1") }
        }
        composeRule.waitForIdle()
    }

    private fun renderAddPlayer() {
        val viewModel = mockk<AddPlayerViewModel>(relaxed = true)
        every { viewModel.uiState } returns MutableStateFlow(
            AddPlayerUiState(
                known = listOf(KnownPlayer("Ana Filipa Rodrigues"), KnownPlayer("Carlos Eduardo Ferreira")),
                isLoading = false,
            ),
        )
        val settingsViewModel = mockk<GameSettingsViewModel>(relaxed = true)
        every { settingsViewModel.uiState } returns
            MutableStateFlow(GameSettingsUiState(isLoading = false, canScheduleExact = true))
        composeRule.setContent {
            ConvocadosWearTheme {
                AddPlayerScreen(
                    eventId = "event-1",
                    viewModel = viewModel,
                    settingsViewModel = settingsViewModel,
                )
            }
        }
        composeRule.waitForIdle()
    }

    /** Reveals the alarm-interval controls, which only render once enabled. */
    private fun expandVibrationAlerts() {
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText(VIBRATION_ALERTS))
        composeRule.waitForIdle()
        composeRule.onNode(hasText(VIBRATION_ALERTS)).performClick()
        composeRule.waitForIdle()
    }

    private fun player(id: String, team: String, order: Int, name: String) =
        WearPlayerEntity(id = id, eventId = "event-1", name = name, order = order, teamAssignment = team)

    private companion object {
        const val VIBRATION_ALERTS = "Vibration alerts"
    }
}
