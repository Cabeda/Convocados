import SwiftUI

struct PlayerRow: View {
    let player: Player
    var isLinked: Bool { player.userId != nil }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isLinked ? "person.fill.checkmark" : "person")
                .foregroundColor(isLinked ? .appPrimary : .secondary)
                .frame(width: 24)

            Text(player.name)
                .font(.body)

            Spacer()

            Text("#\(player.order + 1)")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(player.name), position \(player.order + 1)\(isLinked ? ", linked account" : "")")
    }
}
