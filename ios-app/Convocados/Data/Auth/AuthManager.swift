import AuthenticationServices
import CryptoKit
import Foundation

final class AuthManager: NSObject, ObservableObject {
    @Published var isLoading = false
    @Published var error: String?

    private let tokenStore: TokenStore
    private let settings: SettingsStore
    private var session: ASWebAuthenticationSession?

    init(tokenStore: TokenStore, settings: SettingsStore) {
        self.tokenStore = tokenStore
        self.settings = settings
    }

    var serverURL: String { settings.serverUrl }
    private var callbackScheme: String { "convocados" }

    // MARK: - PKCE

    private func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func generateCodeChallenge(from verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - Login

    @MainActor
    func login() async {
        isLoading = true
        error = nil

        let verifier = generateCodeVerifier()
        let challenge = generateCodeChallenge(from: verifier)

        guard var components = URLComponents(string: "\(serverURL)/api/oauth/authorize") else {
            error = "Invalid server URL"
            isLoading = false
            return
        }

        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: "convocados-ios"),
            URLQueryItem(name: "redirect_uri", value: "\(callbackScheme)://auth/callback"),
            URLQueryItem(name: "scope", value: "openid profile email"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]

        guard let url = components.url else {
            error = "Failed to build auth URL"
            isLoading = false
            return
        }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { url, err in
                    if let err = err {
                        continuation.resume(throwing: err)
                    } else if let url = url {
                        continuation.resume(returning: url)
                    } else {
                        continuation.resume(throwing: AuthError.noCallback)
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                self.session = session
                session.start()
            }

            guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                error = "No authorization code received"
                isLoading = false
                return
            }

            try await exchangeToken(code: code, verifier: verifier)
        } catch let err as ASWebAuthenticationSessionError where err.code == .canceledLogin {
            // User cancelled — not an error
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Token Exchange

    private func exchangeToken(code: String, verifier: String) async throws {
        guard let url = URL(string: "\(serverURL)/api/oauth/token") else {
            throw AuthError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type=authorization_code",
            "code=\(code)",
            "redirect_uri=\(callbackScheme)://auth/callback",
            "client_id=convocados-ios",
            "code_verifier=\(verifier)",
        ].joined(separator: "&")
        request.httpBody = Data(body.utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let token = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
        tokenStore.store(accessToken: token.accessToken, refreshToken: token.refreshToken, expiresIn: token.expiresIn)
    }

    // MARK: - Refresh

    func refreshAccessToken() async -> Bool {
        guard let rt = tokenStore.refreshToken,
              let url = URL(string: "\(serverURL)/api/oauth/token") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type=refresh_token",
            "refresh_token=\(rt)",
            "client_id=convocados-ios",
        ].joined(separator: "&")
        request.httpBody = Data(body.utf8)

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
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
        if let rt = tokenStore.refreshToken,
           let url = URL(string: "\(serverURL)/api/oauth/revoke") {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("token=\(rt)&client_id=convocados-ios".utf8)
            _ = try? await URLSession.shared.data(for: request)
        }
        tokenStore.clear()
    }

    // MARK: - URL Callback

    func handleCallback(url: URL) {
        // Handled via ASWebAuthenticationSession completion
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension AuthManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASPresentationAnchor()
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
