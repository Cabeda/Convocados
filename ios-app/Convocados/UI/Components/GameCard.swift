import SwiftUI

struct GameCard: View {
    let event: EventSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: SportIcon.symbol(for: event.sport))
                .font(.title2)
                .foregroundColor(.appPrimary)
                .frame(width: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.body)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    if !event.location.isEmpty {
                        Label(event.location, systemImage: "mappin")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    Label(formattedDate, systemImage: "calendar")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Text("\(event.playerCount)/\(event.maxPlayers)")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(.appPrimary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(event.title), \(event.playerCount) of \(event.maxPlayers) players")
    }

    private var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: event.dateTime) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: event.dateTime) else { return event.dateTime }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}
