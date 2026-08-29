package dev.convocados.ui.navigation

import dev.convocados.ui.theme.ConvocadosLayout
import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveSceneTest {

    @Test
    fun `compact windows keep event detail full screen`() {
        assertEquals(
            EventSceneMode.FullScreen,
            eventSceneMode(ConvocadosLayout.Compact, selectedEventId = "event-1"),
        )
    }

    @Test
    fun `large windows show the games list before an event is selected`() {
        assertEquals(
            EventSceneMode.ListOnly,
            eventSceneMode(ConvocadosLayout.Expanded, selectedEventId = null),
        )
    }

    @Test
    fun `large windows show games list and selected detail together`() {
        assertEquals(
            EventSceneMode.ListDetail,
            eventSceneMode(ConvocadosLayout.Medium, selectedEventId = "event-1"),
        )
    }

    @Test
    fun `tabletop foldables keep selected detail on a single pane`() {
        assertEquals(
            EventSceneMode.DetailOnly,
            eventSceneMode(
                ConvocadosLayout.Medium,
                selectedEventId = "event-1",
                isTabletop = true,
            ),
        )
    }
    @Test
    fun `tabletop list uses the pane above the horizontal hinge`() {
        assertEquals(
            420,
            tabletopListPaneHeight(windowHeight = 841, hingeTop = 420, hingeBottom = 440),
        )
    }

    @Test
    fun `vertical hinge widths leave the actual hinge out of both panes`() {
        assertEquals(
            HingePaneWidths(left = 673, right = 641, hinge = 20),
            hingePaneWidths(windowWidth = 1334, hingeLeft = 673, hingeRight = 693),
        )
    }

    @Test
    fun `compact deep links are consumed once so Back does not reopen the event`() {
        assertEquals(true, shouldOpenInitialEvent("event-1", consumedEventId = null))
        assertEquals(false, shouldOpenInitialEvent("event-1", consumedEventId = "event-1"))
        assertEquals(true, shouldOpenInitialEvent("event-2", consumedEventId = "event-1"))
    }
}
