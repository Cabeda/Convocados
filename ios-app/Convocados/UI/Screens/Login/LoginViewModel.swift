import Foundation

final class LoginViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var error: String?
    @Published var email = ""
    @Published var password = ""

    private let authManager: AuthManager

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    @MainActor
    func login() async {
        guard !email.isEmpty, !password.isEmpty else {
            error = "Enter your email and password"
            return
        }
        isLoading = true
        error = nil
        await authManager.login(email: email, password: password)
        error = authManager.error
        isLoading = false
    }
}