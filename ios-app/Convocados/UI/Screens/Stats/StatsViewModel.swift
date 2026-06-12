import Foundation

final class StatsViewModel: ObservableObject {
    @Published var stats: PlayerStats?
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    @MainActor
    func loadStats() async {
        isLoading = true
        do {
            stats = try await apiClient.fetchMyStats()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
