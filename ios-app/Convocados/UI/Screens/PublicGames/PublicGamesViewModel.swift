import Foundation

final class PublicGamesViewModel: ObservableObject {
    @Published var events: [PublicEvent] = []
    @Published var searchText = ""
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var filteredEvents: [PublicEvent] {
        if searchText.isEmpty { return events }
        return events.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.location.localizedCaseInsensitiveContains(searchText) ||
            $0.sport.localizedCaseInsensitiveContains(searchText)
        }
    }

    @MainActor
    func loadPublicEvents() async {
        isLoading = true
        do {
            let response = try await apiClient.fetchPublicEvents()
            events = response.data
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
