package dev.convocados.wear.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.ui.screen.auth.AuthScreen
import dev.convocados.wear.ui.screen.games.GamesScreen
import dev.convocados.wear.ui.screen.games.GamesViewModel
import dev.convocados.wear.ui.screen.history.HistoryScreen
import dev.convocados.wear.ui.screen.history.HistoryViewModel
import dev.convocados.wear.ui.screen.mvp.MvpVotingScreen
import dev.convocados.wear.ui.screen.mvp.MvpVotingViewModel
import dev.convocados.wear.ui.screen.quick.QuickScoreScreen
import dev.convocados.wear.ui.screen.quick.QuickScoreViewModel
import dev.convocados.wear.ui.screen.quick.QuickSetupScreen
import dev.convocados.wear.ui.screen.quick.SaveQuickGameScreen
import dev.convocados.wear.ui.screen.quick.SaveQuickGameViewModel
import dev.convocados.wear.ui.screen.score.ScoreScreen
import dev.convocados.wear.ui.screen.score.ScoreViewModel
import dev.convocados.wear.ui.screen.settings.GameSettingsViewModel
import dev.convocados.wear.ui.screen.teams.AddPlayerScreen
import dev.convocados.wear.ui.screen.teams.AddPlayerViewModel
import dev.convocados.wear.ui.screen.teams.TeamsScreen
import dev.convocados.wear.ui.screen.teams.TeamsViewModel

import androidx.wear.compose.material3.AppScaffold

@Composable
fun WearNavigation(
    tokenStore: WearTokenStore,
    googleSignIn: WearGoogleSignIn,
    quickGameStore: QuickGameStore,
) {
    val navController = rememberSwipeDismissableNavController()
    val isAuthenticated by tokenStore.isAuthenticated.collectAsState()
    val activeQuickGame by quickGameStore.state.collectAsState()

    val startDestination = if (isAuthenticated) WearRoutes.GAMES else WearRoutes.AUTH

    AppScaffold {
        SwipeDismissableNavHost(
            navController = navController,
            startDestination = startDestination,
        ) {
            composable(WearRoutes.AUTH) {
                AuthScreen(
                    onAuthenticated = {
                        navController.navigate(WearRoutes.GAMES) {
                            popUpTo(WearRoutes.AUTH) { inclusive = true }
                        }
                    },
                    onQuickGame = {
                        navController.navigate(WearRoutes.QUICK_SETUP)
                    },
                )
            }

            composable(WearRoutes.GAMES) {
                val viewModel: GamesViewModel = hiltViewModel()
                GamesScreen(
                    viewModel = viewModel,
                    onGameSelected = { eventId ->
                        navController.navigate(WearRoutes.score(eventId))
                    },
                    onSignOut = {
                        googleSignIn.signOut()
                        tokenStore.clearTokens()
                        navController.navigate(WearRoutes.AUTH) {
                            popUpTo(WearRoutes.GAMES) { inclusive = true }
                        }
                    },
                    onQuickGame = {
                        navController.navigate(WearRoutes.QUICK_SETUP)
                    },
                    onHistory = {
                        navController.navigate(WearRoutes.HISTORY)
                    },
                    continueQuickGame = activeQuickGame.isLive(System.currentTimeMillis()),
                    onContinueQuickGame = {
                        launchQuickGame(navController, "continue", null, null)
                    },
                )
            }

            composable(WearRoutes.SCORE) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val viewModel: ScoreViewModel = hiltViewModel()
                ScoreScreen(
                    eventId = eventId,
                    viewModel = viewModel,
                    onTeams = {
                        navController.navigate(WearRoutes.teams(eventId))
                    },
                    onFinish = {
                        navController.popBackStack()
                    },
                )
            }

            composable(WearRoutes.TEAMS) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val viewModel: TeamsViewModel = hiltViewModel()
                val settingsViewModel: GameSettingsViewModel = hiltViewModel()
                TeamsScreen(
                    eventId = eventId,
                    viewModel = viewModel,
                    settingsViewModel = settingsViewModel,
                    onDone = { navController.popBackStack() },
                    onKickoff = { navController.popBackStack() },
                    onAddPlayer = {
                        navController.navigate(WearRoutes.addPlayer(eventId))
                    },
                )
            }

            composable(WearRoutes.ADD_PLAYER) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val viewModel: AddPlayerViewModel = hiltViewModel()
                AddPlayerScreen(
                    eventId = eventId,
                    viewModel = viewModel,
                    onDone = { navController.popBackStack() },
                )
            }

            composable(WearRoutes.QUICK_SETUP) {
                QuickSetupScreen(
                    activeGame = activeQuickGame.takeIf { it.isStarted },
                    onStart = { duration, alarmInterval, sport ->
                        launchQuickGame(navController, "new", duration, alarmInterval, sport)
                    },
                    onContinue = {
                        launchQuickGame(navController, "continue", null, null)
                    },
                    onRestart = {
                        launchQuickGame(navController, "restart", null, null)
                    },
                )
            }

            composable(WearRoutes.QUICK_SCORE) { backStackEntry ->
                val viewModel: QuickScoreViewModel = hiltViewModel()
                val mode = backStackEntry.savedStateHandle.get<String>("quickMode")
                val duration = backStackEntry.savedStateHandle.get<Int>("duration")
                val alarmInterval = backStackEntry.savedStateHandle.get<Int>("alarmInterval")
                val sport = backStackEntry.savedStateHandle.get<String>("sport")
                LaunchedEffect(mode) {
                    when (mode) {
                        "new" -> viewModel.startNew(duration ?: 60, alarmInterval ?: 10, sport ?: "standard")
                        "restart" -> viewModel.restart()
                        else -> viewModel.continueGame()
                    }
                }
                QuickScoreScreen(
                    viewModel = viewModel,
                    onEnd = {
                        viewModel.endGame()
                        navController.popBackStack()
                    },
                    onRestart = {
                        viewModel.restart()
                    },
                    onSave = {
                        navController.navigate(WearRoutes.SAVE_QUICK)
                    },
                )
            }

            composable(WearRoutes.SAVE_QUICK) {
                val viewModel: SaveQuickGameViewModel = hiltViewModel()
                SaveQuickGameScreen(
                    viewModel = viewModel,
                    onDone = { navController.popBackStack() },
                )
            }

            composable(WearRoutes.HISTORY) {
                val viewModel: HistoryViewModel = hiltViewModel()
                HistoryScreen(
                    viewModel = viewModel,
                    onHistorySelected = { eventId, historyId ->
                        navController.navigate(WearRoutes.mvp(eventId, historyId))
                    },
                )
            }

            composable(WearRoutes.MVP) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val historyId = backStackEntry.arguments?.getString("historyId") ?: return@composable
                val viewModel: MvpVotingViewModel = hiltViewModel()
                MvpVotingScreen(
                    eventId = eventId,
                    historyId = historyId,
                    viewModel = viewModel,
                )
            }
        }
    }
}

/** Navigate to the quick score, tagging the entry with how to (re)start it. */
private fun launchQuickGame(
    navController: androidx.navigation.NavController,
    mode: String,
    duration: Int?,
    alarmInterval: Int?,
    sport: String? = null,
) {
    navController.navigate(WearRoutes.QUICK_SCORE) {
        popUpTo(WearRoutes.QUICK_SETUP) { inclusive = true }
    }
    val handle = navController.currentBackStackEntry?.savedStateHandle ?: return
    handle["quickMode"] = mode
    if (duration != null) handle["duration"] = duration
    if (alarmInterval != null) handle["alarmInterval"] = alarmInterval
    if (sport != null) handle["sport"] = sport
}
