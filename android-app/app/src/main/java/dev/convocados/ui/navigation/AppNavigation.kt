package dev.convocados.ui.navigation

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SportsScore
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.convocados.ui.screen.login.LoginScreen
import dev.convocados.ui.screen.games.GamesScreen
import dev.convocados.ui.screen.stats.StatsScreen
import dev.convocados.ui.screen.profile.ProfileScreen
import dev.convocados.ui.screen.create.CreateEventScreen
import dev.convocados.ui.screen.event.EventDetailScreen
import dev.convocados.ui.screen.publicgames.PublicGamesScreen
import dev.convocados.ui.screen.settings.EventSettingsScreen
import dev.convocados.ui.screen.rankings.RankingsScreen
import dev.convocados.ui.screen.payments.PaymentsScreen
import dev.convocados.ui.screen.attendance.AttendanceScreen
import dev.convocados.ui.screen.log.EventLogScreen
import dev.convocados.ui.screen.notifications.NotificationPrefsScreen
import dev.convocados.ui.screen.user.UserProfileScreen
import dev.convocados.ui.screen.history.HistoryDetailScreen
import dev.convocados.ui.screen.history.EventHistoryScreen
import dev.convocados.ui.screen.history.EventHistoryScreen
import dev.convocados.ui.screen.map.MapPickerScreen

data class BottomNavItem(val route: String, val label: String, val icon: @Composable () -> Unit)

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun AppNavigation(isAuthenticated: Boolean, deepLink: String? = null) {
    val navController = rememberNavController()
    val startDestination = if (isAuthenticated) Route.Games.route else Route.Login.route

    // Handle deep link navigation
    LaunchedEffect(deepLink, isAuthenticated) {
        if (!isAuthenticated || deepLink == null) return@LaunchedEffect
        val route = deepLinkToRoute(deepLink)
        if (route != null) {
            navController.navigate(route) { launchSingleTop = true }
        }
    }

    val bottomItems = listOf(
        BottomNavItem(Route.Games.route, "Games") { Icon(Icons.Default.SportsScore, "Games") },
        BottomNavItem(Route.Stats.route, "Stats") { Icon(Icons.Default.BarChart, "Stats") },
        BottomNavItem(Route.Profile.route, "Profile") { Icon(Icons.Default.Person, "Profile") },
    )

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination
    val showBottomBar = currentDestination?.hierarchy?.any { dest ->
        bottomItems.any { it.route == dest.route }
    } == true

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    bottomItems.forEach { item ->
                        val selected = currentDestination?.hierarchy?.any { it.route == item.route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = item.icon,
                            label = { Text(item.label) },
                        )
                    }
                }
            }
        }
    ) { padding ->
        SharedTransitionLayout {
            NavHost(
                navController = navController,
                startDestination = startDestination,
                modifier = Modifier.padding(padding),
            ) {
                composable(Route.Login.route) {
                    LoginScreen(onLoginSuccess = {
                        navController.navigate(Route.Games.route) {
                            popUpTo(Route.Login.route) { inclusive = true }
                        }
                    })
                }
                composable(Route.Games.route) {
                    GamesScreen(
                        onEventClick = { navController.navigate(Route.EventDetail.create(it)) },
                        onCreateClick = { navController.navigate(Route.CreateEvent.route) },
                        onPublicClick = { navController.navigate(Route.PublicGames.route) },
                        sharedTransitionScope = this@SharedTransitionLayout,
                        animatedVisibilityScope = this@composable,
                    )
                }
                composable(Route.Stats.route) {
                    StatsScreen(onEventClick = { navController.navigate(Route.EventDetail.create(it)) })
                }
                composable(Route.Profile.route) {
                    ProfileScreen(
                        onLogout = {
                            navController.navigate(Route.Login.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        },
                        onNotificationPrefs = { navController.navigate(Route.NotificationPrefs.route) },
                    )
                }
                composable(Route.CreateEvent.route) {
                    CreateEventScreen(
                        onCreated = { id ->
                            navController.navigate(Route.EventDetail.create(id)) {
                                popUpTo(Route.CreateEvent.route) { inclusive = true }
                            }
                        },
                        onBack = { navController.popBackStack() },
                        onPickMap = { navController.navigate(Route.MapPicker.route) },
                    )
                }
                composable(Route.MapPicker.route) {
                    MapPickerScreen(
                        onLocationPicked = { _, _ -> navController.popBackStack() },
                        onBack = { navController.popBackStack() },
                    )
                }
                composable(
                    Route.EventDetail().route + "?action={action}",
                    arguments = listOf(
                        navArgument("eventId") { type = NavType.StringType },
                        navArgument("action") { type = NavType.StringType; defaultValue = "" },
                    ),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    val autoOpenPay = entry.arguments?.getString("action") == "pay"
                    EventDetailScreen(
                        eventId = eventId,
                        autoOpenPay = autoOpenPay,
                        onBack = { navController.popBackStack() },
                        onSettings = { navController.navigate(Route.EventSettings.create(eventId)) },
                        onRankings = { navController.navigate(Route.EventRankings.create(eventId)) },
                        onPayments = { navController.navigate(Route.EventPayments.create(eventId)) },
                        onLog = { navController.navigate(Route.EventLog.create(eventId)) },
                        onAttendance = { navController.navigate(Route.EventAttendance.create(eventId)) },
                        onNotificationPrefs = { navController.navigate(Route.NotificationPrefs.route) },
                        onUserClick = { navController.navigate(Route.UserProfile.create(it)) },
                        onHistoryClick = { historyId -> navController.navigate(Route.HistoryDetail.create(eventId, historyId)) },
                        onAllHistory = { navController.navigate(Route.EventHistory.create(eventId)) },
                        sharedTransitionScope = this@SharedTransitionLayout,
                        animatedVisibilityScope = this@composable,
                    )
                }
                composable(
                    Route.EventSettings().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    EventSettingsScreen(
                        eventId = eventId,
                        onBack = { navController.popBackStack() },
                        onRankings = { navController.navigate(Route.EventRankings.create(eventId)) },
                        onPayments = { navController.navigate(Route.EventPayments.create(eventId)) },
                        onLog = { navController.navigate(Route.EventLog.create(eventId)) },
                        onAttendance = { navController.navigate(Route.EventAttendance.create(eventId)) },
                    )
                }
                composable(
                    Route.EventRankings().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    RankingsScreen(eventId = eventId, onBack = { navController.popBackStack() }, onUserClick = { navController.navigate(Route.UserProfile.create(it)) })
                }
                composable(
                    Route.EventPayments().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    PaymentsScreen(eventId = eventId, onBack = { navController.popBackStack() })
                }
                composable(
                    Route.EventAttendance().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    AttendanceScreen(eventId = eventId, onBack = { navController.popBackStack() })
                }
                composable(
                    Route.EventLog().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    EventLogScreen(eventId = eventId, onBack = { navController.popBackStack() })
                }
                composable(Route.PublicGames.route) {
                    PublicGamesScreen(
                        onEventClick = { navController.navigate(Route.EventDetail.create(it)) },
                        onBack = { navController.popBackStack() },
                        sharedTransitionScope = this@SharedTransitionLayout,
                        animatedVisibilityScope = this@composable,
                    )
                }
                composable(Route.NotificationPrefs.route) {
                    NotificationPrefsScreen(onBack = { navController.popBackStack() })
                }
                composable(
                    Route.UserProfile().route,
                    arguments = listOf(navArgument("userId") { type = NavType.StringType }),
                ) { entry ->
                    val userId = entry.arguments?.getString("userId") ?: return@composable
                    UserProfileScreen(
                        userId = userId,
                        onBack = { navController.popBackStack() },
                        onEventClick = { navController.navigate(Route.EventDetail.create(it)) },
                    )
                }
                composable(
                    Route.HistoryDetail().route,
                    arguments = listOf(
                        navArgument("eventId") { type = NavType.StringType },
                        navArgument("historyId") { type = NavType.StringType },
                    ),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    val historyId = entry.arguments?.getString("historyId") ?: return@composable
                    HistoryDetailScreen(
                        eventId = eventId,
                        historyId = historyId,
                        onBack = { navController.popBackStack() },
                    )
                }
                composable(
                    Route.EventHistory().route,
                    arguments = listOf(navArgument("eventId") { type = NavType.StringType }),
                ) { entry ->
                    val eventId = entry.arguments?.getString("eventId") ?: return@composable
                    EventHistoryScreen(
                        eventId = eventId,
                        onBack = { navController.popBackStack() },
                        onHistoryClick = { historyId -> navController.navigate(Route.HistoryDetail.create(eventId, historyId)) },
                    )
                }
            }
        }
    }
}

private fun deepLinkToRoute(url: String): String? {
    // Handle paths like /events/{id} or full URLs
    val path = url.removePrefix("https://convocados.cabeda.dev")
        .removePrefix("http://localhost:4321")
    val eventMatch = Regex("/events?/([^/?]+)").find(path)
    if (eventMatch != null) {
        val id = eventMatch.groupValues[1]
        val actionPay = url.contains("action=pay")
        return Route.EventDetail.create(id) + if (actionPay) "?action=pay" else ""
    }
    if (path == "/games" || url == "games") return Route.Games.route
    if (path == "/create" || url == "create") return Route.CreateEvent.route
    return null
}
