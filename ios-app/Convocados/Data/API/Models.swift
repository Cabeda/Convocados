import Foundation

// MARK: - Events

struct EventSummary: Codable, Identifiable {
    let id: String
    let title: String
    var location: String = ""
    let dateTime: String
    var sport: String = ""
    let maxPlayers: Int
    let playerCount: Int
    var archivedAt: String?
    var isRecurring: Bool = false
    var lastScoreOne: Int?
    var lastScoreTwo: Int?
}

struct MyGamesResponse: Codable {
    var owned: [EventSummary] = []
    var admin: [EventSummary] = []
    var followed: [EventSummary] = []
    var archivedOwned: [EventSummary] = []
    var ownedNextCursor: String?
    var ownedHasMore: Bool = false
    var followedNextCursor: String?
    var followedHasMore: Bool = false
}

struct Player: Codable, Identifiable {
    let id: String
    let name: String
    let order: Int
    var userId: String?
    var createdAt: String = ""
}

struct TeamMember: Codable, Identifiable {
    let id: String
    let name: String
    let order: Int
}

struct TeamResult: Codable, Identifiable {
    let id: String
    let name: String
    var members: [TeamMember] = []
}

struct EventDetail: Codable, Identifiable {
    let id: String
    let title: String
    var location: String = ""
    var latitude: Double?
    var longitude: Double?
    let dateTime: String
    var timezone: String = ""
    let maxPlayers: Int
    var teamOneName: String = "Team 1"
    var teamTwoName: String = "Team 2"
    var sport: String = ""
    var durationMinutes: Int = 60
    var isPublic: Bool = false
    var isRecurring: Bool = false
    var recurrenceRule: String?
    var nextResetAt: String?
    var ownerId: String?
    var ownerName: String?
    var isAdmin: Bool = false
    var hasPassword: Bool = false
    var eloEnabled: Bool = false
    var hideEloInTeams: Bool = false
    var splitCostsEnabled: Bool = false
    var mvpEnabled: Bool = true
    var balanced: Bool = false
    var archivedAt: String?
    var createdAt: String = ""
    var updatedAt: String = ""
    var players: [Player] = []
    var teamResults: [TeamResult]?
    var wasReset: Bool = false
    var locked: Bool = false
}

// MARK: - History

struct EloUpdate: Codable {
    let name: String
    let delta: Int
}

struct GameHistory: Codable, Identifiable {
    let id: String
    let dateTime: String
    var status: String = "played"
    var scoreOne: Int?
    var scoreTwo: Int?
    var teamOneName: String = ""
    var teamTwoName: String = ""
    var teamsSnapshot: String?
    var paymentsSnapshot: String?
    var editableUntil: String = ""
    var createdAt: String = ""
    var editable: Bool = false
    var source: String = "live"
    var eloUpdates: [EloUpdate]?
}

struct PaginatedHistory: Codable {
    var data: [GameHistory] = []
    var nextCursor: String?
    var hasMore: Bool = false
}

// MARK: - Stats

struct PlayerStats: Codable {
    let summary: StatsSummary
    var events: [EventStats] = []
}

struct StatsSummary: Codable {
    var totalGames: Int = 0
    var totalWins: Int = 0
    var totalDraws: Int = 0
    var totalLosses: Int = 0
    var winRate: Double = 0.0
    var avgRating: Int = 0
    var bestRating: Int = 0
    var eventsPlayed: Int = 0
}

struct AttendanceInfo: Codable {
    var gamesPlayed: Int = 0
    var totalGames: Int = 0
    var attendanceRate: Double = 0.0
    var currentStreak: Int = 0
}

struct EventStats: Codable {
    let eventId: String
    let eventTitle: String
    var sport: String = ""
    var rating: Int = 1000
    var gamesPlayed: Int = 0
    var wins: Int = 0
    var draws: Int = 0
    var losses: Int = 0
    var winRate: Double = 0.0
    var attendance: AttendanceInfo?
}

// MARK: - User

struct UserProfile: Codable {
    let id: String
    let name: String
    let email: String
    var image: String?
}

struct OAuthTokenResponse: Codable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

// MARK: - Public Events

struct PublicEvent: Codable, Identifiable {
    let id: String
    let title: String
    var location: String = ""
    var latitude: Double?
    var longitude: Double?
    var sport: String = ""
    let dateTime: String
    let maxPlayers: Int
    let playerCount: Int
    let spotsLeft: Int
}

struct PaginatedPublicEvents: Codable {
    var data: [PublicEvent] = []
    var nextCursor: String?
    var hasMore: Bool = false
}

// MARK: - Ratings

struct PlayerRating: Codable, Identifiable {
    let id: String
    let name: String
    let rating: Int
    var initialRating: Int?
    var gamesPlayed: Int = 0
    var wins: Int = 0
    var draws: Int = 0
    var losses: Int = 0
}

struct PaginatedRatings: Codable {
    var data: [PlayerRating] = []
    var nextCursor: String?
    var hasMore: Bool = false
}

// MARK: - Payments

struct Payment: Codable, Identifiable {
    let id: String
    let playerName: String
    var amount: Double = 0.0
    var status: String = "pending"
    var method: String?
    var paidAt: String?
    var createdAt: String = ""
    var updatedAt: String = ""
}

struct PaymentSummary: Codable {
    var paidCount: Int = 0
    var pendingCount: Int = 0
    var totalCount: Int = 0
    var paidAmount: Double = 0.0
}

struct PaymentsResponse: Codable {
    var payments: [Payment] = []
    var summary: PaymentSummary = PaymentSummary()
    var currency: String?
    var totalAmount: Double?
}

// MARK: - Post Game

struct PostGameStatus: Codable {
    var gameEnded: Bool = false
    var hasScore: Bool = false
    var hasCost: Bool = false
    var allPaid: Bool = false
    var allComplete: Bool = false
    var isParticipant: Bool = false
    var latestHistoryId: String?
    var costCurrency: String?
    var costAmount: Double?
    var hasPendingPastPayments: Bool = false
}

// MARK: - Notifications

struct NotificationPrefs: Codable {
    var emailEnabled: Bool = true
    var pushEnabled: Bool = true
    var gameInviteEmail: Bool = true
    var gameInvitePush: Bool = true
    var gameReminderEmail: Bool = true
    var gameReminderPush: Bool = true
    var playerActivityPush: Bool = true
    var eventDetailsPush: Bool = true
    var weeklySummaryEmail: Bool = true
    var paymentReminderEmail: Bool = true
    var paymentReminderPush: Bool = true
    var reminder24h: Bool = true
    var reminder2h: Bool = true
    var reminder1h: Bool = true
}

// MARK: - Event Log

struct EventLogEntry: Codable, Identifiable {
    let id: String
    let action: String
    var actor: String?
    var actorId: String?
    let createdAt: String
}

struct PaginatedLog: Codable {
    var entries: [EventLogEntry] = []
    var nextCursor: String?
    var hasMore: Bool = false
}

// MARK: - Attendance

struct AttendanceRecord: Codable {
    let name: String
    var gamesPlayed: Int = 0
    var totalGames: Int = 0
    var attendanceRate: Double = 0.0
    var currentStreak: Int = 0
    var lastPlayed: String?
}

struct AttendanceResult: Codable {
    var players: [AttendanceRecord] = []
    var totalGames: Int = 0
}

// MARK: - Known Players

struct KnownPlayer: Codable {
    let name: String
    var gamesPlayed: Int = 0
}

struct KnownPlayersResponse: Codable {
    var players: [KnownPlayer] = []
}

// MARK: - User Profiles

struct UserPublicProfile: Codable {
    let id: String
    let name: String
    var image: String?
    var stats: PublicStats?
}

struct UserProfileResponse: Codable {
    let user: UserPublicProfile
    var stats: ProfileStats?
    var owned: [ProfileEvent] = []
    var joined: [ProfileEvent] = []
}

struct ProfileStats: Codable {
    var totalGames: Int = 0
    var ownedGames: Int = 0
    var joinedGames: Int = 0
}

struct ProfileEvent: Codable, Identifiable {
    let id: String
    let title: String
    var dateTime: String = ""
    var sport: String = ""
    var playerCount: Int = 0
    var maxPlayers: Int = 10
}

struct PublicStats: Codable {
    var totalGames: Int = 0
    var totalWins: Int = 0
    var totalDraws: Int = 0
    var totalLosses: Int = 0
    var winRate: Double = 0.0
    var avgRating: Int = 0
}

// MARK: - Generic Responses

struct OkResponse: Codable {
    var ok: Bool = true
}

struct AddPlayerResponse: Codable {
    var ok: Bool = true
    var invited: String?
    var resolvedName: String?
}

struct RemovePlayerResponse: Codable {
    var ok: Bool = true
    var undo: UndoData?
}

struct UndoData: Codable {
    let name: String
    let order: Int
    var userId: String?
    let removedAt: Int
}

struct CreateEventResponse: Codable {
    let id: String
}

// MARK: - MVP

struct MvpVoteRequest: Codable {
    let votedForPlayerId: String
}

struct MvpVoteResponse: Codable {
    var ok: Bool = true
    var vote: MvpVoteDetail?
}

struct MvpVoteDetail: Codable {
    let id: String
    let votedForName: String
}

struct MvpCandidate: Codable {
    let playerId: String
    let playerName: String
    let voteCount: Int
}

struct MvpVoteSummary: Codable {
    let voterName: String
    let votedForName: String
}

struct MvpResponse: Codable {
    var mvp: [MvpCandidate]?
    var votes: [MvpVoteSummary] = []
    var isVotingOpen: Bool = false
    var hasVoted: Bool?
    var totalVotes: Int = 0
}

// MARK: - Follow

struct FollowStateResponse: Codable {
    var following: Bool = false
    var mutePlayerActivity: Bool?
    var muteReminders: Bool?
    var mutePostGame: Bool?
    var muteEventDetails: Bool?
}

struct FollowOverridesRequest: Codable {
    var mutePlayerActivity: Bool?
    var muteReminders: Bool?
    var mutePostGame: Bool?
    var muteEventDetails: Bool?
}

// MARK: - Court Finder

struct CourtAlternative: Codable {
    let tenantId: String
    let tenantName: String
    let resourceName: String
    let slotTime: String
    let price: Double
    var currency: String = "EUR"
    var status: String = "available"
    var playtomicUrl: String = ""
    var distanceKm: Double = 0.0
    var coordinate: CourtCoordinate?
}

struct CourtCoordinate: Codable {
    let lat: Double
    let lng: Double
}

struct CourtAlternativesResponse: Codable {
    var alternatives: [CourtAlternative] = []
}

struct CourtWatch: Codable, Identifiable {
    let id: String
    var sport: String = ""
    var tenantId: String = ""
    var tenantName: String = ""
    var resourceId: String = ""
    var resourceName: String = ""
    var dayOfWeek: Int = 1
    var startTime: String = ""
    var endTime: String = ""
    var timezone: String = ""
    var createdAt: String = ""
}

struct CourtWatchesResponse: Codable {
    var watches: [CourtWatch] = []
}

struct CreateCourtWatchRequest: Codable {
    let sport: String
    let tenantId: String
    let tenantName: String
    let resourceId: String
    let resourceName: String
    let dayOfWeek: Int
    let startTime: String
    let endTime: String
    let timezone: String
}

// MARK: - Balance

struct PlayerBalance: Codable {
    var playerName: String = ""
    var amount: Double = 0.0
    var gamesOwed: Int = 0
    var streak: Int = 0
}

struct BalanceAggregate: Codable {
    var paidCount: Int = 0
    var totalCount: Int = 0
}

struct BalanceResponse: Codable {
    var enforcement: String = "nudge"
    var threshold: Double = 0.0
    var callerBalance: PlayerBalance?
    var aggregate: BalanceAggregate = BalanceAggregate()
    var balances: [PlayerBalance] = []
}

// MARK: - Request Bodies

struct CreateEventRequest: Codable {
    let title: String
    var location: String?
    let dateTime: String
    var timezone: String?
    var maxPlayers: Int?
    var sport: String?
    var teamOneName: String?
    var teamTwoName: String?
    var isRecurring: Bool = false
    var recurrenceFreq: String?
    var recurrenceInterval: Int?
}

struct AddPlayerRequest: Codable {
    let name: String
    var linkToAccount: Bool = true
    var email: String?
}

struct UpdateTeamsRequest: Codable {
    let teamOnePlayerIds: [String]
    let teamTwoPlayerIds: [String]
}

struct PaymentUpdateRequest: Codable {
    let playerName: String
    let status: String
}

struct CostOverrideRequest: Codable {
    let playerName: String
    let amount: Double
}

struct ReorderPlayersRequest: Codable {
    let playerIds: [String]
}

struct TransferRequest: Codable {
    let targetUserId: String
}

struct UpdateProfileRequest: Codable {
    let name: String
}
