import SwiftUI

extension Color {
    static let appPrimary = Color(red: 0.106, green: 0.420, blue: 0.290) // #1B6B4A
    static let appSecondary = Color(red: 0.180, green: 0.545, blue: 0.400)
    static let appSurface = Color(.systemBackground)
    static let appOnSurface = Color(.label)
    static let appError = Color.red
}

extension View {
    func cardStyle() -> some View {
        self
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
    }
}

// MARK: - Sport Icons

enum SportIcon {
    static func symbol(for sport: String) -> String {
        switch sport.lowercased() {
        case "football", "soccer", "futsal": return "sportscourt"
        case "basketball": return "basketball"
        case "tennis": return "tennis.racket"
        case "volleyball": return "volleyball"
        case "padel", "paddle": return "tennis.racket"
        case "running": return "figure.run"
        case "cycling": return "bicycle"
        case "swimming": return "figure.pool.swim"
        default: return "sportscourt"
        }
    }
}
