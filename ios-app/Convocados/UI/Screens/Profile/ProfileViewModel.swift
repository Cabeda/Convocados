import Foundation

final class ProfileViewModel: ObservableObject {
    @Published var profile: UserProfile?
    @Published var isLoading = false

    let apiClient: APIClient
    private let authManager: AuthManager
    private let settings: SettingsStore

    init(apiClient: APIClient, authManager: AuthManager, settings: SettingsStore) {
        self.apiClient = apiClient
        self.authManager = authManager
        self.settings = settings
    }

    @MainActor
    func loadProfile() async {
        isLoading = true
        profile = try? await apiClient.fetchUserInfo()
        isLoading = false
    }

    @MainActor
    func logout() async {
        await authManager.logout()
    }
}
