import Foundation

final class RankingsViewModel: ObservableObject {
    @Published var ratings: [PlayerRating] = []
    @Published var isLoading = false
    @Published var error: String?

    private let eventId: String
    private let apiClient: APIClient

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        self.apiClient = apiClient
    }

    @MainActor
    func loadRatings() async {
        isLoading = true
        do {
            let response = try await apiClient.fetchRatings(eventId: eventId)
            ratings = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
