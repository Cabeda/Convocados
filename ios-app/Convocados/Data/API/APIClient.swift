import Foundation

final class APIClient: ObservableObject {
    private let tokenStore: TokenStore
    private let settings: SettingsStore
    private weak var authManager: AuthManager?
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()
    private let encoder = JSONEncoder()

    init(tokenStore: TokenStore, settings: SettingsStore) {
        self.tokenStore = tokenStore
        self.settings = settings
    }

    func setAuthManager(_ manager: AuthManager) {
        self.authManager = manager
    }

    private var baseURL: String { settings.serverUrl }

    // MARK: - HTTP Methods

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "GET")
    }

    func post<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "POST")
    }

    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "POST", body: body)
    }

    func put<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "PUT")
    }

    func put<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "PUT", body: body)
    }

    func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "PATCH", body: body)
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "DELETE")
    }

    func delete<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "DELETE", body: body)
    }

    // MARK: - Core Request

    private func request<T: Decodable>(path: String, method: String, body: (any Encodable)? = nil, isRetry: Bool = false) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let token = tokenStore.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let (data, response) = try await URLSession.shared.data(for: req)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 && !isRetry {
            let refreshed = await authManager?.refreshAccessToken() ?? false
            if refreshed {
                return try await request(path: path, method: method, body: body, isRetry: true)
            } else {
                await MainActor.run { tokenStore.clear() }
                throw APIError.unauthorized
            }
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
        }

        return try decoder.decode(T.self, from: data)
    }

    // MARK: - API Methods

    func fetchMyGames() async throws -> MyGamesResponse {
        try await get("/api/me/games")
    }

    func fetchMyStats() async throws -> PlayerStats {
        try await get("/api/me/stats")
    }

    func fetchUserInfo() async throws -> UserProfile {
        try await get("/api/me/profile")
    }

    func fetchEvent(id: String) async throws -> EventDetail {
        try await get("/api/events/\(id)")
    }

    func fetchHistory(id: String, cursor: String? = nil) async throws -> PaginatedHistory {
        let qs = cursor.map { "?cursor=\($0)" } ?? ""
        return try await get("/api/events/\(id)/history\(qs)")
    }

    func fetchKnownPlayers(id: String) async throws -> KnownPlayersResponse {
        try await get("/api/events/\(id)/known-players")
    }

    func fetchPostGameStatus(id: String) async throws -> PostGameStatus {
        try await get("/api/events/\(id)/post-game-status")
    }

    func addPlayer(eventId: String, name: String, linkToAccount: Bool = true, email: String? = nil) async throws -> AddPlayerResponse {
        try await post("/api/events/\(eventId)/players", body: AddPlayerRequest(name: name, linkToAccount: linkToAccount, email: email))
    }

    func removePlayer(eventId: String, playerId: String) async throws -> RemovePlayerResponse {
        struct Body: Codable { let playerId: String }
        return try await delete("/api/events/\(eventId)/players", body: Body(playerId: playerId))
    }

    func randomizeTeams(eventId: String, balanced: Bool = false) async throws -> OkResponse {
        let qs = balanced ? "?balanced=true" : ""
        return try await post("/api/events/\(eventId)/randomize\(qs)")
    }

    func createEvent(data: CreateEventRequest) async throws -> CreateEventResponse {
        try await post("/api/events", body: data)
    }

    func archiveEvent(eventId: String) async throws -> OkResponse {
        struct Body: Codable { let archive: Bool }
        return try await put("/api/events/\(eventId)/archive", body: Body(archive: true))
    }

    func unarchiveEvent(eventId: String) async throws -> OkResponse {
        struct Body: Codable { let archive: Bool }
        return try await put("/api/events/\(eventId)/archive", body: Body(archive: false))
    }

    func fetchPublicEvents(cursor: String? = nil) async throws -> PaginatedPublicEvents {
        let qs = cursor.map { "?cursor=\($0)" } ?? ""
        return try await get("/api/events/public\(qs)")
    }

    func fetchRatings(eventId: String, cursor: String? = nil) async throws -> PaginatedRatings {
        let qs = cursor.map { "?cursor=\($0)&limit=50" } ?? "?limit=50"
        return try await get("/api/events/\(eventId)/ratings\(qs)")
    }

    func fetchPayments(eventId: String) async throws -> PaymentsResponse {
        try await get("/api/events/\(eventId)/payments")
    }

    func updatePaymentStatus(eventId: String, playerName: String, status: String) async throws -> OkResponse {
        try await put("/api/events/\(eventId)/payments", body: PaymentUpdateRequest(playerName: playerName, status: status))
    }

    func fetchBalance(eventId: String) async throws -> BalanceResponse {
        try await get("/api/events/\(eventId)/balance")
    }

    func fetchAttendance(eventId: String) async throws -> AttendanceResult {
        try await get("/api/events/\(eventId)/attendance")
    }

    func fetchNotificationPrefs() async throws -> NotificationPrefs {
        try await get("/api/me/notification-preferences")
    }

    func updateNotificationPrefs(_ prefs: [String: Bool]) async throws -> NotificationPrefs {
        try await put("/api/me/notification-preferences", body: prefs)
    }

    func updateProfile(name: String) async throws -> UserProfile {
        try await put("/api/me/profile", body: UpdateProfileRequest(name: name))
    }

    func followEvent(eventId: String) async throws -> FollowStateResponse {
        try await post("/api/events/\(eventId)/follow")
    }

    func unfollowEvent(eventId: String) async throws -> FollowStateResponse {
        try await delete("/api/events/\(eventId)/follow")
    }

    func getShareURL(eventId: String) -> String {
        "\(baseURL)/events/\(eventId)"
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case httpError(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid response"
        case .unauthorized: return "Session expired. Please log in again."
        case .httpError(let code, let msg): return "Error \(code): \(msg)"
        }
    }
}

// MARK: - Type Erasure for Encodable

private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        _encode = { encoder in try value.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
