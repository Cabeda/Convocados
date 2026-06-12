import Foundation

final class HistoryDetailViewModel: ObservableObject {
    @Published var history: [GameHistory] = []
    @Published var isLoading = false
    @Published var error: String?

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
}
