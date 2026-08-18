package dev.convocados.ui.screen.event

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.test.FakeImage
import coil3.test.FakeImageLoaderEngine
import dev.convocados.data.api.Player
import dev.convocados.ui.theme.ConvocadosTheme
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PlayerRowTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Before
    @Suppress("DEPRECATION") // FakeImage is deprecated in favor of coil-core ColorImage
    fun setUpImageLoader() {
        // Deterministic image loading for AsyncImage — never hits the network.
        val context = ApplicationProvider.getApplicationContext<Context>()
        SingletonImageLoader.setUnsafe(
            ImageLoader.Builder(context)
                .components { add(FakeImageLoaderEngine.Builder().default(FakeImage()).build()) }
                .build()
        )
    }

    @Test
    fun `linked player without image shows first-initial avatar`() {
        composeRule.setContent {
            ConvocadosTheme {
                PlayerRow(player = Player("p1", "Alice", 0, userId = "u1", image = null), onUserClick = {})
            }
        }
        composeRule.onNodeWithContentDescription("Alice").assertIsDisplayed()
    }

    @Test
    fun `linked player with image renders an avatar image`() {
        composeRule.setContent {
            ConvocadosTheme {
                PlayerRow(player = Player("p1", "Alice", 0, userId = "u1", image = "https://example.com/alice.jpg"), onUserClick = {})
            }
        }
        composeRule.onNodeWithContentDescription("Alice").assertIsDisplayed()
    }

    @Test
    fun `anonymous player shows anonymous icon`() {
        composeRule.setContent {
            ConvocadosTheme {
                PlayerRow(player = Player("p1", "Carol", 0, userId = null, image = null))
            }
        }
        composeRule.onNodeWithContentDescription("Anonymous player").assertIsDisplayed()
    }

    @Test
    fun `avatar click invokes onUserClick for a linked player`() {
        var clicked = false
        composeRule.setContent {
            ConvocadosTheme {
                PlayerRow(
                    player = Player("p1", "Alice", 0, userId = "u1", image = null),
                    onUserClick = { clicked = true },
                )
            }
        }
        composeRule.onNodeWithContentDescription("Alice").performClick()
        assertTrue(clicked)
    }
}
