package dev.convocados.wear.data.auth

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WearTokenStoreTest {

    private lateinit var store: WearTokenStore

    @Before
    fun setup() {
        store = WearTokenStore(ApplicationProvider.getApplicationContext())
        store.clearTokens()
    }

    @Test
    fun initially_not_authenticated() {
        // After clearTokens, a fresh store should report not authenticated
        val freshStore = WearTokenStore(ApplicationProvider.getApplicationContext())
        assertFalse(freshStore.isAuthenticated.value)
        assertNull(freshStore.getTokens())
    }

    @Test
    fun setTokens_and_getTokens_round_trips() {
        val tokens = OAuthTokens(
            accessToken = "access_123",
            refreshToken = "refresh_456",
            expiresAt = System.currentTimeMillis() + 3600_000,
        )
        store.setTokens(tokens)

        val retrieved = store.getTokens()
        assertNotNull(retrieved)
        assertEquals("access_123", retrieved!!.accessToken)
        assertEquals("refresh_456", retrieved.refreshToken)
        assertTrue(store.isAuthenticated.value)
    }

    @Test
    fun clearTokens_wipes_all_keys() {
        store.setTokens(OAuthTokens("a", "b", 999))
        store.clearTokens()

        assertNull(store.getTokens())
        assertFalse(store.isAuthenticated.value)
    }

    @Test
    fun isExpired_returns_true_when_no_tokens() {
        assertTrue(store.isExpired())
    }

    @Test
    fun isExpired_returns_false_for_future_expiry() {
        store.setTokens(OAuthTokens("a", "b", System.currentTimeMillis() + 3600_000))
        assertFalse(store.isExpired())
    }

    @Test
    fun isExpired_returns_true_when_within_60s_of_expiry() {
        store.setTokens(OAuthTokens("a", "b", System.currentTimeMillis() + 30_000))
        assertTrue(store.isExpired()) // 30s left < 60s buffer
    }

    @Test
    fun isExpired_returns_true_for_past_expiry() {
        store.setTokens(OAuthTokens("a", "b", System.currentTimeMillis() - 1000))
        assertTrue(store.isExpired())
    }

    @Test
    fun getServerUrl_returns_default_when_not_set() {
        assertEquals("https://convocados.fly.dev", store.getServerUrl())
    }

    @Test
    fun setServerUrl_and_getServerUrl_round_trips() {
        store.setServerUrl("http://10.0.2.2:4321")
        assertEquals("http://10.0.2.2:4321", store.getServerUrl())
    }

    @Test
    fun setServerUrl_can_switch_between_local_and_prod() {
        store.setServerUrl("http://10.0.2.2:4321")
        assertEquals("http://10.0.2.2:4321", store.getServerUrl())

        store.setServerUrl("https://convocados.fly.dev")
        assertEquals("https://convocados.fly.dev", store.getServerUrl())
    }

    @Test
    fun isAuthenticated_stateFlow_updates_on_set_and_clear() {
        assertFalse(store.isAuthenticated.value)

        store.setTokens(OAuthTokens("a", "b", 999))
        assertTrue(store.isAuthenticated.value)

        store.clearTokens()
        assertFalse(store.isAuthenticated.value)
    }
}
