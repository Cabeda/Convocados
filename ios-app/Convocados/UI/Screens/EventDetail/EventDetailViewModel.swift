import Foundation

final class EventDetailViewModel: ObservableObject {
    @Published var event: EventDetail?
    @Published var isLoading = false
    @Published var error: String?

    let eventId: String
    let apiClient: APIClient

    var shareURL: String { apiClient.getShareURL(eventId: eventId) }

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        self.apiClient = apiClient
    }

    @MainActor
    func loadEvent() async {
        isLoading = true
        error = nil
        do {
            event = try await apiClient.fetchEvent(id: eventId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    func addPlayer(name: String) async {
        do {
            _ = try await apiClient.addPlayer(eventId: eventId, name: name)
            await loadEvent()
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func removePlayer(playerId: String) async {
        do {
            _ = try await apiClient.removePlayer(eventId: eventId, playerId: playerId)
            await loadEvent()
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func randomize(balanced: Bool) async {
        do {
            _ = try await apiClient.randomizeTeams(eventId: eventId, balanced: balanced)
            await loadEvent()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
