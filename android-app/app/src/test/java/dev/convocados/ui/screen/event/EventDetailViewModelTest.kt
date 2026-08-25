package dev.convocados.ui.screen.event

import app.cash.turbine.test
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coJustRun
import io.mockk.slot
import kotlinx.coroutines.flow.flowOf
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Ignore
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventDetailViewModelTest {
    private val repository = mockk<EventRepository>(relaxUnitFun = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val client = mockk<ApiClient>(relaxed = true)
    private val settingsStore = mockk<dev.convocados.data.datastore.SettingsStore>(relaxed = true) {
        every { autoPayOnJoin } returns flowOf(false)
    }
    private val testDispatcher = StandardTestDispatcher()

    private val eventId = "event-123"
    private val mockEvent = EventDetail(
        id = eventId,
        title = "Test Event",
        location = "Test Location",
        dateTime = "2024-01-01T10:00:00Z",
        maxPlayers = 10,
        players = emptyList(),
        ownerId = "user-1",
        isAdmin = true
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load fetches event details and history`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.event.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertEquals(mockEvent, expectMostRecentItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load sets locked state when event is password protected`() = runTest {
        val lockedEvent = mockEvent.copy(locked = true)
        coEvery { repository.getEventDetail(eventId) } returns flowOf(lockedEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertEquals(true, expectMostRecentItem().locked)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `addPlayer calls api and reloads event`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.addPlayer(eventId, "New Player", true, null, any()) } coAnswers { Result.success(null as String?) }

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.addPlayer(eventId, "New Player")
        advanceUntilIdle()

        coVerify { repository.addPlayer(eventId, "New Player", true, null, any()) }
    }

    @Test
    fun `addPlayer generates a fresh Idempotency-Key per call`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        val keySlot1 = slot<String>()
        val keySlot2 = slot<String>()
        coEvery { repository.addPlayer(eventId, "P1", true, null, capture(keySlot1)) } coAnswers { Result.success(null as String?) }
        coEvery { repository.addPlayer(eventId, "P2", true, null, capture(keySlot2)) } coAnswers { Result.success(null as String?) }

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.addPlayer(eventId, "P1")
        viewModel.addPlayer(eventId, "P2")
        advanceUntilIdle()

        // Two distinct UUID-shaped keys.
        val k1 = keySlot1.captured
        val k2 = keySlot2.captured
        assertTrue(k1.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
        assertTrue(k2.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
        assertTrue(k1 != k2)
    }

    @Ignore("MockK cannot handle kotlin.Result inline class — ClassCastException at runtime (pre-existing)")
    @Test
    fun `removePlayer calls repository`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        val undo = UndoData(name = "Player One", order = 1, userId = "p-1", removedAt = 123456789L)
        coEvery { repository.removePlayer(eventId, "p-1") } returns Result.success(undo)

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.removePlayer(eventId, "p-1")
        advanceUntilIdle()

        coVerify { repository.removePlayer(eventId, "p-1") }
    }

    @Ignore("MockK cannot handle kotlin.Result inline class — ClassCastException at runtime (pre-existing)")
    @Test
    fun `verifyPassword calls repository`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent.copy(locked = true))
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.verifyPassword(eventId, "secret") } returns Result.success(Unit)

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.verifyPassword(eventId, "secret")
        advanceUntilIdle()

        coVerify { repository.verifyPassword(eventId, "secret") }
    }

    @Test
    fun `load fetches post-game status and exposes it in state`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val postGame = PostGameStatus(
            gameEnded = true,
            hasScore = false,
            hasCost = true,
            allPaid = false,
            allComplete = false,
            isParticipant = true,
            latestHistoryId = "hist-1",
            hasPendingPastPayments = false,
        )
        coEvery { api.fetchPostGameStatus(eventId) } returns postGame

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            val state = expectMostRecentItem()
            assertNotNull(state.postGame)
            assertEquals(true, state.postGame?.gameEnded)
            assertEquals(false, state.postGame?.hasScore)
            assertEquals(true, state.postGame?.hasCost)
            assertEquals(false, state.postGame?.allPaid)
            assertEquals("hist-1", state.postGame?.latestHistoryId)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { api.fetchPostGameStatus(eventId) }
    }

    @Test
    fun `load handles post-game status fetch failure gracefully`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.fetchPostGameStatus(eventId) } throws RuntimeException("Network error")

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertNull(expectMostRecentItem().postGame)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `follow refreshes cached games list so followed section updates`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.followEvent(eventId) } returns FollowStateResponse(following = true)

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.toggleFollow(eventId)
        advanceUntilIdle()

        coVerify { api.followEvent(eventId) }
        coVerify { repository.refreshMyGames() }
    }

    @Test
    fun `unfollow refreshes cached games list so followed section updates`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        // Start already-following so toggleFollow goes down the unfollow path.
        coEvery { api.getFollowState(eventId) } returns FollowStateResponse(following = true)
        coEvery { api.unfollowEvent(eventId) } returns FollowStateResponse(following = false)

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.load(eventId)
        advanceUntilIdle()
        viewModel.toggleFollow(eventId)
        advanceUntilIdle()

        coVerify { api.unfollowEvent(eventId) }
        coVerify { repository.refreshMyGames() }
    }

    @Test
    fun `resend invite calls api and surfaces success notice`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.resendInvite(eventId, "inv-1") } returns InviteResendResponse(ok = true, channels = InviteChannels(email = true))

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.resendInvite(eventId, "inv-1", "Bob")
            advanceUntilIdle()

            coVerify { api.resendInvite(eventId, "inv-1") }
            val last = expectMostRecentItem()
            assertTrue(last.resendingInviteId == null)
            assertEquals(InviteResendNotice(playerName = "Bob"), last.resendNotice)
        }
    }

    @Test
    fun `resend invite failure surfaces error`() = runTest {
        coEvery { api.resendInvite(eventId, "inv-1") } throws ApiException(400, "boom")

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.resendInvite(eventId, "inv-1", "Bob")
            advanceUntilIdle()

            assertEquals("boom", expectMostRecentItem().error)
        }
    }

    @Test
    fun `resend invite cooldown surfaces retry notice`() = runTest {
        coEvery { api.resendInvite(eventId, "inv-1") } throws ApiException(
            429,
            """{"error":"cooldown","retryAfterSeconds":6000}""",
        )

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.resendInvite(eventId, "inv-1", "Bob")
            advanceUntilIdle()

        assertEquals(
            InviteResendNotice(playerName = "Bob", cooldownSeconds = 6000),
            expectMostRecentItem().resendNotice,
        )
    }

    @Test
    fun `invite with no notification channel surfaces share invite`() = runTest {
        coEvery { api.sendInvite(eventId, "u-new") } returns InviteCreateResponse(
            ok = true,
            inviteUrl = "https://convocados.cabeda.dev/invite/abc",
            channels = InviteChannels(email = false, webPush = false, appPush = false),
        )

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.inviteSuggestion(eventId, "u-new", "Luís")
            advanceUntilIdle()

            assertEquals(
                PendingShareInvite("https://convocados.cabeda.dev/invite/abc", "Luís"),
                expectMostRecentItem().pendingShareInvite,
            )
        }
    }

    @Test
    fun `invite with a notification channel does not offer share`() = runTest {
        coEvery { api.sendInvite(eventId, "u-new") } returns InviteCreateResponse(
            ok = true,
            inviteUrl = "https://convocados.cabeda.dev/invite/abc",
            channels = InviteChannels(email = true, webPush = false, appPush = false),
        )

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.inviteSuggestion(eventId, "u-new", "Luís")
            advanceUntilIdle()

            assertNull(expectMostRecentItem().pendingShareInvite)
        }
    }

    }

    @Test
    fun `refresh re-fetches post-game status`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val postGame = PostGameStatus(gameEnded = true, hasScore = true, allPaid = true, allComplete = true)
        coEvery { api.fetchPostGameStatus(eventId) } returns postGame

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()

            viewModel.refresh(eventId)
            advanceUntilIdle()
            cancelAndIgnoreRemainingEvents()
        }
        coVerify(exactly = 2) { api.fetchPostGameStatus(eventId) }
    }

    @Test
    fun `load seeds editable past-game payment snapshot from status`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val postGame = PostGameStatus(
            gameEnded = false, // post-reset: next game upcoming
            hasScore = true,
            hasCost = true,
            allPaid = false,
            hasPendingPastPayments = true,
            latestHistoryId = "hist-1",
            paymentsSnapshot = listOf(
                PaymentSnapshotEntry("coutinho", 5.0, "pending"),
                PaymentSnapshotEntry("José Cabeda", 5.0, "paid"),
            ),
        )
        coEvery { api.fetchPostGameStatus(eventId) } returns postGame

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            val state = expectMostRecentItem()
            // The banner edits the PAST game snapshot, not the live next-game payments.
            assertEquals(2, state.postGamePayments?.size)
            assertEquals("pending", state.postGamePayments?.first { it.playerName == "coutinho" }?.status)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `togglePostGamePayment flips status locally and marks dirty`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.fetchPostGameStatus(eventId) } returns PostGameStatus(
            gameEnded = true, hasScore = true, hasCost = true, allPaid = false,
            latestHistoryId = "hist-1",
            paymentsSnapshot = listOf(PaymentSnapshotEntry("coutinho", 5.0, "pending")),
        )

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()

            viewModel.togglePostGamePayment("coutinho")
            advanceUntilIdle()
            val state = expectMostRecentItem()
            assertEquals("paid", state.postGamePayments?.first()?.status)
            assertTrue(state.postGamePaymentsDirty)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `savePostGamePayments PATCHes history snapshot and clears dirty`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        val pending = PostGameStatus(
            gameEnded = true, hasScore = true, hasCost = true, allPaid = false,
            latestHistoryId = "hist-1",
            paymentsSnapshot = listOf(PaymentSnapshotEntry("coutinho", 5.0, "pending")),
        )
        val settled = pending.copy(
            allPaid = true, allComplete = true,
            paymentsSnapshot = listOf(PaymentSnapshotEntry("coutinho", 5.0, "paid")),
        )
        coEvery { api.fetchPostGameStatus(eventId) } returnsMany listOf(pending, settled)
        coEvery { api.updateHistoryPayments(eventId, "hist-1", any()) } returns
            GameHistory(id = "hist-1", dateTime = "2026-06-22T18:00:00Z")

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            viewModel.togglePostGamePayment("coutinho")
            viewModel.savePostGamePayments(eventId)
            advanceUntilIdle()

            val state = expectMostRecentItem()
            assertEquals(false, state.postGamePaymentsDirty)
            assertEquals(true, state.postGame?.allComplete)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { api.updateHistoryPayments(eventId, "hist-1", match { it.first().status == "paid" }) }
    }

    @Test
    fun `savePostGamePayments surfaces error on 403 and keeps dirty`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.fetchPostGameStatus(eventId) } returns PostGameStatus(
            gameEnded = true, hasScore = true, hasCost = true, allPaid = false,
            latestHistoryId = "hist-1",
            paymentsSnapshot = listOf(PaymentSnapshotEntry("coutinho", 5.0, "pending")),
        )
        coEvery { api.updateHistoryPayments(eventId, "hist-1", any()) } throws
            ApiException(403, "{\"error\":\"Only the event owner can do this.\"}")

        val viewModel = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)
        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            viewModel.togglePostGamePayment("coutinho")
            viewModel.savePostGamePayments(eventId)
            advanceUntilIdle()

            val state = expectMostRecentItem()
            assertTrue(state.postGamePaymentsDirty)
            assertNotNull(state.error)
            assertEquals(false, state.postGameSaving)
            cancelAndIgnoreRemainingEvents()
        }
    }

}
