import Foundation

final class GamesViewModel: ObservableObject {
    @Published var myGames: [EventSummary] = []
    @Published var adminGames: [EventSummary] = []
    @Published var followedGames: [EventSummary] = []
    @Published var archivedGames: [EventSummary] = []
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    @MainActor
    func loadGames() async {
        isLoading = true
        error = nil
        do {
            let response = try await apiClient.fetchMyGames()
            myGames = response.owned
            adminGames = response.admin
            followedGames = response.followed
            archivedGames = response.archivedOwned
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
