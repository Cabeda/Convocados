import SwiftUI

struct SportIconView: View {
    let sport: String
    var size: Font = .title2

    var body: some View {
        Image(systemName: SportIcon.symbol(for: sport))
            .font(size)
            .foregroundColor(.appPrimary)
            .accessibilityLabel(sport.isEmpty ? "Sport" : sport)
    }
}
