package dev.convocados.wear.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.ui.screen.auth.AuthScreen
import dev.convocados.wear.ui.screen.games.GamesScreen
import dev.convocados.wear.ui.screen.games.GamesViewModel
import dev.convocados.wear.ui.screen.score.ScoreScreen
import dev.convocados.wear.ui.screen.score.ScoreViewModel
import dev.convocados.wear.ui.screen.teams.TeamsScreen
import dev.convocados.wear.ui.screen.teams.TeamsViewModel

import com.google.android.horologist.compose.layout.AppScaffold
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState

@Composable
fun WearNavigation(tokenStore: WearTokenStore) {
    val navController = rememberSwipeDismissableNavController()
    val isAuthenticated by tokenStore.isAuthenticated.collectAsState()

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
                    }
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
                        tokenStore.clearTokens()
                        navController.navigate(WearRoutes.AUTH) {
                            popUpTo(WearRoutes.GAMES) { inclusive = true }
                        }
                    },
                )
            }

            composable(WearRoutes.SCORE) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val viewModel: ScoreViewModel = hiltViewModel()
                ScoreScreen(
                    eventId = eventId,
                    viewModel = viewModel,
                    onDone = { navController.popBackStack() },
                    onTeams = { id -> navController.navigate(WearRoutes.teams(id)) },
                )
            }

            composable(WearRoutes.TEAMS) { backStackEntry ->
                val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
                val viewModel: TeamsViewModel = hiltViewModel()
                TeamsScreen(
                    eventId = eventId,
                    viewModel = viewModel,
                    onDone = { navController.popBackStack() },
                )
            }
        }
    }
}
