import Foundation

final class AuthManager: NSObject, ObservableObject {
    @Published var isLoading = false
    @Published var error: String?

    private let tokenStore: TokenStore
    private let settings: SettingsStore

    init(tokenStore: TokenStore, settings: SettingsStore) {
        self.tokenStore = tokenStore
        self.settings = settings
    }

    var serverURL: String { settings.serverUrl }
    private var baseURL: String { settings.serverUrl }

    // MARK: - Login

    @MainActor
    func login(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        guard let url = URL(string: "\(baseURL)/api/auth/mobile-native") else {
            error = "Invalid server URL"
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "action": "email-signin",
                "email": email,
                "password": password,
            ])

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                error = "Invalid response"
                return
            }
            guard (200...299).contains(http.statusCode) else {
                let msg = (try? JSONDecoder().decode(MobileAuthErrorResponse.self, from: data))?.error
                    ?? "Login failed (HTTP \(http.statusCode))"
                self.error = msg
                return
            }

            let token = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
            tokenStore.store(accessToken: token.accessToken, refreshToken: token.refreshToken, expiresIn: token.expiresIn)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Refresh

    func refreshAccessToken() async -> Bool {
        guard let rt = tokenStore.refreshToken,
              let url = URL(string: "\(baseURL)/api/auth/oauth2/token") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = "grant_type=refresh_token&refresh_token=\(rt)&client_id=convocados-mobile-app"
        request.httpBody = Data(body.utf8)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return false }
            let token = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
            tokenStore.store(accessToken: token.accessToken, refreshToken: token.refreshToken, expiresIn: token.expiresIn)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Logout

    @MainActor
    func logout() async {
        tokenStore.clear()
    }

    // MARK: - URL Callback

    func handleCallback(url: URL) {
        // Handled via /api/auth/mobile-native email/password flow
    }
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case noCallback
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .noCallback: return "No callback URL received"
        case .invalidURL: return "Invalid server URL"
        }
    }
}

private struct MobileAuthErrorResponse: Decodable {
    let error: String?
}