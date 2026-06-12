import Foundation

final class CreateEventViewModel: ObservableObject {
    @Published var title = ""
    @Published var location = ""
    @Published var dateTime = Date()
    @Published var sport = "football"
    @Published var maxPlayers = 10
    @Published var isRecurring = false
    @Published var recurrenceFreq = "weekly"
    @Published var isLoading = false
    @Published var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    @MainActor
    func createEvent() async -> Bool {
        isLoading = true
        error = nil

        let formatter = ISO8601DateFormatter()
        let request = CreateEventRequest(
            title: title,
            location: location.isEmpty ? nil : location,
            dateTime: formatter.string(from: dateTime),
            timezone: TimeZone.current.identifier,
            maxPlayers: maxPlayers,
            sport: sport,
            isRecurring: isRecurring,
            recurrenceFreq: isRecurring ? recurrenceFreq : nil
        )

        do {
            _ = try await apiClient.createEvent(data: request)
            isLoading = false
            return true
        } catch {
            self.error = error.localizedDescription
            isLoading = false
            return false
        }
    }
}
