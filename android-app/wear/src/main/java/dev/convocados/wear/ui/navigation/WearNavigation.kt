package dev.convocados.wear.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import dev.convocados.wear.ui.screen.auth.AuthScreen
import dev.convocados.wear.ui.screen.auth.AuthViewModel
import dev.convocados.wear.ui.screen.games.GamesScreen
import dev.convocados.wear.ui.screen.games.GamesViewModel
import dev.convocados.wear.ui.screen.score.ScoreScreen
import dev.convocados.wear.ui.screen.score.ScoreViewModel

@Composable
fun WearNavigation() {
    val navController = rememberSwipeDismissableNavController()
    val authViewModel: AuthViewModel = hiltViewModel()
    val isAuthenticated by authViewModel.isAuthenticated.collectAsState()

    val startDestination = if (isAuthenticated) WearRoutes.GAMES else WearRoutes.AUTH

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
            )
        }

        composable(WearRoutes.SCORE) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: return@composable
            val viewModel: ScoreViewModel = hiltViewModel()
            ScoreScreen(
                eventId = eventId,
                viewModel = viewModel,
                onDone = { navController.popBackStack() },
            )
        }
    }
}
