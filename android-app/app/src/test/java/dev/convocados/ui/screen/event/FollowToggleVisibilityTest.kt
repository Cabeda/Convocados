package dev.convocados.ui.screen.event

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression for the "follow button disappeared" report: a user who is a player
 * but NOT following (organizer add-by-name auto-links without auto-following, or
 * they unfollowed from the dashboard) was left with no follow control at all —
 * losing notifications and the game from "My Games".
 */
class FollowToggleVisibilityTest {

    @Test
    fun `non-player not following shows the toggle`() {
        assertTrue(shouldShowFollowToggle(isPlayer = false, isFollowing = false))
    }

    @Test
    fun `non-player following shows the toggle so they can unfollow`() {
        assertTrue(shouldShowFollowToggle(isPlayer = false, isFollowing = true))
    }

    @Test
    fun `player not following shows the toggle so they can opt in`() {
        assertTrue(shouldShowFollowToggle(isPlayer = true, isFollowing = false))
    }

    @Test
    fun `auto-followed player hides the toggle`() {
        assertFalse(shouldShowFollowToggle(isPlayer = true, isFollowing = true))
    }
}
