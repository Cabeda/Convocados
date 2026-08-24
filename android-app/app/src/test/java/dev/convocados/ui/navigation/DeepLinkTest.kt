package dev.convocados.ui.navigation

import android.content.Intent
import android.net.Uri
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regression tests for the deep-link round-trip (ADR-0012, Convocados-04z).
 *
 * Before the fix, `MainActivity.extractDeepLink` only checked `intent.getStringExtra`,
 * so a `convocados://events/<id>` link from a push notification or share button never
 * reached the navigation layer — the user landed on Login or Games, never on the event.
 *
 * The fix reads `intent.data` first, then falls back to the extras for backward compat
 * with explicit test/dev injections.
 *
 * Robolectric is required because [DeepLink] uses [Uri.parse] to normalize the URL.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DeepLinkTest {

    @Test
    fun `convocados scheme event URL is resolved from intent dot data`() {
        val intent = mockk<Intent>()
        every { intent.data } returns Uri.parse("convocados://events/evt-abc")
        every { intent.getStringExtra(any()) } returns null

        assertEquals("convocados://events/evt-abc", DeepLink.extract(intent))
    }

    @Test
    fun `https web event URL is resolved from intent dot data`() {
        val intent = mockk<Intent>()
        every { intent.data } returns Uri.parse("https://convocados.cabeda.dev/events/evt-abc")
        every { intent.getStringExtra(any()) } returns null

        assertEquals("https://convocados.cabeda.dev/events/evt-abc", DeepLink.extract(intent))
    }

    @Test
    fun `convocados scheme with port for local dev is resolved`() {
        val intent = mockk<Intent>()
        every { intent.data } returns Uri.parse("http://localhost:4321/events/evt-abc")
        every { intent.getStringExtra(any()) } returns null

        assertEquals("http://localhost:4321/events/evt-abc", DeepLink.extract(intent))
    }

    @Test
    fun `getStringExtra deep_link takes priority over intent dot data (backward compat)`() {
        val intent = mockk<Intent>()
        every { intent.data } returns Uri.parse("convocados://events/from-data")
        every { intent.getStringExtra("deep_link") } returns "https://example.com/from-extras"
        every { intent.getStringExtra("navigate_to") } returns null

        // Extras win — they represent an explicit, debug-grade override
        assertEquals("https://example.com/from-extras", DeepLink.extract(intent))
    }

    @Test
    fun `getStringExtra navigate_to is used as fallback when no deep_link extra`() {
        val intent = mockk<Intent>()
        every { intent.data } returns null
        every { intent.getStringExtra("deep_link") } returns null
        every { intent.getStringExtra("navigate_to") } returns "https://example.com/from-navigate"

        assertEquals("https://example.com/from-navigate", DeepLink.extract(intent))
    }

    @Test
    fun `getStringExtra url is used as last-resort fallback (FCM data extras)`() {
        // When an FCM message carries a `notification` block, Firebase auto-displays it
        // and merges the data payload into the launch intent as raw extras — the key
        // is the server's data map key ("url"), not our "deep_link" convention.
        val intent = mockk<Intent>()
        every { intent.data } returns null
        every { intent.getStringExtra("deep_link") } returns null
        every { intent.getStringExtra("navigate_to") } returns null
        every { intent.getStringExtra("url") } returns "/events/evt-fcm"

        assertEquals("/events/evt-fcm", DeepLink.extract(intent))
    }

    @Test
    fun `null intent returns null without throwing`() {
        assertNull(DeepLink.extract(null))
    }

    @Test
    fun `intent with no data and no extras returns null`() {
        val intent = mockk<Intent>()
        every { intent.data } returns null
        every { intent.getStringExtra(any()) } returns null

        assertNull(DeepLink.extract(intent))
    }

    @Test
    fun `OAuth callback URI is still extractable (consumed by RootViewModel separately)`() {
        // The OAuth callback (convocados://auth?code=...) is handled by RootViewModel.handleIntent
        // which exchanges the code for tokens. It is NOT a navigation deep link. We still want
        // extract() to return it so the AppNavigation effect doesn't navigate to "auth" by mistake
        // — the LaunchedEffect in AppNavigation will filter it via deepLinkToRoute.
        val intent = mockk<Intent>()
        every { intent.data } returns Uri.parse("convocados://auth?code=mcode_xxx")
        every { intent.getStringExtra(any()) } returns null

        assertEquals("convocados://auth?code=mcode_xxx", DeepLink.extract(intent))
    }

    // ── deepLinkToRoute resolution ───────────────────────────────────────────

    @Test
    fun `deepLinkToRoute resolves convocados events url to EventDetail route`() {
        val route = DeepLink.deepLinkToRoute("convocados://events/evt-abc")
        assertEquals("event/evt-abc", route)
    }

    @Test
    fun `deepLinkToRoute resolves https eventos url to EventDetail route`() {
        val route = DeepLink.deepLinkToRoute("https://convocados.cabeda.dev/events/evt-abc")
        assertEquals("event/evt-abc", route)
    }

    @Test
    fun `deepLinkToRoute preserves action=pay query param`() {
        val route = DeepLink.deepLinkToRoute("convocados://events/evt-abc?action=pay")
        assertEquals("event/evt-abc?action=pay", route)
    }

    @Test
    fun `deepLinkToRoute returns null for OAuth callback (auth is not a navigation target)`() {
        val route = DeepLink.deepLinkToRoute("convocados://auth?code=mcode_xxx")
        assertNull(route)
    }

    @Test
    fun `deepLinkToRoute resolves games`() {
        val route = DeepLink.deepLinkToRoute("convocados://games")
        assertEquals("games", route)
    }

    @Test
    fun `deepLinkToRoute resolves create`() {
        val route = DeepLink.deepLinkToRoute("convocados://create")
        assertEquals("create", route)
    }

    @Test
    fun `deepLinkToRoute resolves court watches url`() {
        // Server sends absolute APP_URL/court-watches from the court-watch cron
        assertEquals(
            "court-watches",
            DeepLink.deepLinkToRoute("https://convocados.cabeda.dev/court-watches"),
        )
    }

    @Test
    fun `deepLinkToRoute resolves convocados court watches url`() {
        val route = DeepLink.deepLinkToRoute("convocados://court-watches")
        assertEquals("court-watches", route)
    }

    @Test
    fun `deepLinkToRoute maps organizer dashboard url to games`() {
        // No dashboard screen on Android — organizer digest notifications land on Games
        assertEquals("games", DeepLink.deepLinkToRoute("/dashboard"))
    }

    @Test
    fun `deepLinkToRoute returns null for unknown url`() {
        assertNull(DeepLink.deepLinkToRoute("convocados://settings/unknown"))
    }
}
