import Foundation

final class HistoryDetailViewModel: ObservableObject {
    @Published var history: [GameHistory] = []
    @Published var isLoading = false
    @Published var error: String?

    /// Match-event timeline per history id (ADR 0039).
    @Published var matchEvents: [String: [MatchEvent]] = [:]
    @Published var matchEventsLoading = false

    private let eventId: String
    private let apiClient: APIClient

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        self.apiClient = apiClient
    }

    @MainActor
    func loadHistory() async {
        isLoading = true
        do {
            let response = try await apiClient.fetchHistory(id: eventId)
            history = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// The event detail (roster for the scorer picker).
    func fetchEvent() async throws -> EventDetail {
        try await apiClient.fetchEvent(id: eventId)
    }

    /// Load the goal timeline for one settled game.
    @MainActor
    func loadMatchEvents(historyId: String) async {
        matchEventsLoading = true
        do {
            let response = try await apiClient.fetchMatchEvents(eventId: eventId, historyId: historyId)
            matchEvents[historyId] = response.events
        } catch {
            self.error = error.localizedDescription
        }
        matchEventsLoading = false
    }

    /// Log a goal and refresh the timeline + the score (goals drive it).
    @MainActor
    func addGoal(historyId: String, team: String, scorer: Player, minute: Int?, count: Int, ownGoal: Bool, penalty: Bool) async {
        do {
            _ = try await apiClient.addMatchEvent(
                eventId: eventId,
                historyId: historyId,
                body: MatchEventRequest(
                    type: "goal",
                    team: team,
                    minute: minute,
                    count: count,
                    ownGoal: ownGoal,
                    penalty: penalty,
                    scorerEventPlayerId: scorer.id,
                    scorerName: scorer.name
                )
            )
            await loadMatchEvents(historyId: historyId)
            await loadHistory()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Remove a logged goal and refresh the timeline + the score.
    @MainActor
    func removeGoal(historyId: String, matchEventId: String) async {
        do {
            _ = try await apiClient.deleteMatchEvent(eventId: eventId, historyId: historyId, matchEventId: matchEventId)
            await loadMatchEvents(historyId: historyId)
            await loadHistory()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
