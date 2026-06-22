package dev.convocados.ui.navigation

import android.content.Intent
import android.net.Uri

/**
 * Deep-link entry point for the Android app.
 *
 * Two consumers share the `Intent` delivered to [MainActivity]:
 *
 * 1. **Navigation deep links** — `convocados://events/<id>`, `https://.../events/<id>`,
 *    `convocados://games`, `convocados://create`. These must be resolved to a
 *    Compose [Route] and navigated to. The flow is:
 *    `MainActivity` → `DeepLink.extract(intent)` → `LaunchedEffect(deepLink, isAuthenticated)`
 *    in [AppNavigation] → `DeepLink.deepLinkToRoute(url)` → `navController.navigate(route)`.
 *
 * 2. **OAuth callback** — `convocados://auth?code=...`. Handled by
 *    `RootViewModel.handleIntent` which exchanges the code for tokens. The URL is
 *    NOT a navigation target — `deepLinkToRoute` returns null for it.
 *
 * The fix from ADR-0012 (Convocados-04z) is that `extract()` now reads
 * `intent.data` (the actual URI of the deep link) **first**, then falls back
 * to the `getStringExtra` paths for backward compat with explicit test/dev
 * injections. Before the fix, only the extras were read, so scheme URLs
 * from push notifications or share buttons were silently dropped.
 */
object DeepLink {

    /** Extra keys that callers (tests, dev shortcuts) can use to inject a deep link. */
    const val EXTRA_DEEP_LINK = "deep_link"
    const val EXTRA_NAVIGATE_TO = "navigate_to"

    /**
     * Read the deep link from an [Intent]. Returns the URL string (any scheme/host)
     * the caller can hand to [deepLinkToRoute], or `null` if no deep link is present.
     *
     * Priority: extras first (explicit, debug-grade), then `intent.data` (the
     * default for real scheme/web links from notifications/shares).
     */
    fun extract(intent: Intent?): String? {
        if (intent == null) return null
        intent.getStringExtra(EXTRA_DEEP_LINK)?.let { return it }
        intent.getStringExtra(EXTRA_NAVIGATE_TO)?.let { return it }
        return intent.data?.toString()
    }

    /**
     * Resolve a deep-link URL to a Compose [Route] path. Returns `null` when the
     * URL is not a navigation target (e.g. the OAuth callback, or an unknown host).
     *
     * Supported inputs:
     * - `convocados://events/<id>` → `event/<id>`
     * - `convocados://events/<id>?action=pay` → `event/<id>?action=pay`
     * - `https://convocados.cabeda.dev/events/<id>` → `event/<id>`
     * - `http://localhost:4321/events/<id>` → `event/<id>`
     * - `convocados://games` → `games`
     * - `convocados://create` → `create`
     * - `convocados://auth?code=...` → null (OAuth callback, not a nav target)
     */
    fun deepLinkToRoute(url: String): String? {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return null

        // OAuth callback is never a navigation target
        if (uri.scheme == "convocados" && uri.host == "auth") return null

        // Strip the scheme://host prefix to a path
        val path = when {
            uri.scheme == "convocados" -> "/" + (uri.host.orEmpty() + uri.path.orEmpty()).removePrefix("/")
            else -> uri.path.orEmpty()
        }

        // Event detail: /events/<id> or /event/<id>
        val eventMatch = Regex("^/?events?/([^/?]+)").find(path)
        if (eventMatch != null) {
            val id = eventMatch.groupValues[1]
            val actionPay = url.contains("action=pay")
            return Route.EventDetail.create(id) + if (actionPay) "?action=pay" else ""
        }

        // Top-level routes
        return when (path.removePrefix("/")) {
            "games" -> Route.Games.route
            "create" -> Route.CreateEvent.route
            else -> null
        }
    }
}
