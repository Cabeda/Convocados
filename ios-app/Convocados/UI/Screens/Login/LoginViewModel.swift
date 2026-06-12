import Foundation

final class LoginViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var error: String?

    private let authManager: AuthManager

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    @MainActor
    func login() async {
        isLoading = true
        error = nil
        await authManager.login()
        error = authManager.error
        isLoading = false
    }
}
