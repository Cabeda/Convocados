import Foundation

final class PaymentsViewModel: ObservableObject {
    @Published var payments: PaymentsResponse?
    @Published var isLoading = false
    @Published var error: String?

    private let eventId: String
    private let apiClient: APIClient

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        self.apiClient = apiClient
    }

    @MainActor
    func loadPayments() async {
        isLoading = true
        do {
            payments = try await apiClient.fetchPayments(eventId: eventId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
