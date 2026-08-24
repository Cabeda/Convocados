package dev.convocados.data.push

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for the notification type → channel routing table.
 * Extracted from ConvocadosFcmService so additions fail loudly here
 * instead of silently landing in the default channel.
 */
class NotificationChannelsTest {

    @Test
    fun `reminders route to game reminders channel`() {
        assertEquals(
            ConvocadosFcmService.CHANNEL_GAME_REMINDERS,
            ConvocadosFcmService.channelIdFor("reminder"),
        )
    }

    @Test
    fun `player activity types route to player activity channel`() {
        for (type in listOf(
            "player_joined", "player_left", "player_joined_bench",
            "player_left_bench", "player_left_promoted",
            "game_full", "spot_available", "bench_promoted_capacity", "rsvp_request",
        )) {
            assertEquals(type, ConvocadosFcmService.CHANNEL_PLAYER_ACTIVITY, ConvocadosFcmService.channelIdFor(type))
        }
    }

    @Test
    fun `player invited routes to event updates channel`() {
        // Direct invite to a specific user — same tier as game_invite
        assertEquals(
            ConvocadosFcmService.CHANNEL_EVENT_UPDATES,
            ConvocadosFcmService.channelIdFor("player_invited"),
        )
    }

    @Test
    fun `post game routes to post game channel`() {
        assertEquals(ConvocadosFcmService.CHANNEL_POST_GAME, ConvocadosFcmService.channelIdFor("post_game"))
    }

    @Test
    fun `payment types route to payment channel`() {
        assertEquals(ConvocadosFcmService.CHANNEL_PAYMENT_REMINDERS, ConvocadosFcmService.channelIdFor("payment_confirmed"))
        assertEquals(ConvocadosFcmService.CHANNEL_PAYMENT_REMINDERS, ConvocadosFcmService.channelIdFor("payment_self_reported"))
    }

    @Test
    fun `event level types route to event updates channel`() {
        for (type in listOf(
            "game_cancelled", "game_invite", "event_details",
            "recruitment", "few_spots_left",
        )) {
            assertEquals(type, ConvocadosFcmService.CHANNEL_EVENT_UPDATES, ConvocadosFcmService.channelIdFor(type))
        }
    }

    @Test
    fun `null and unknown types fall back to player activity`() {
        assertEquals(ConvocadosFcmService.CHANNEL_PLAYER_ACTIVITY, ConvocadosFcmService.channelIdFor(null))
        assertEquals(ConvocadosFcmService.CHANNEL_PLAYER_ACTIVITY, ConvocadosFcmService.channelIdFor("unknown_type"))
    }
}
