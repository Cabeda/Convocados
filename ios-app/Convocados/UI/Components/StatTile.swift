import SwiftUI

struct StatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.appPrimary)
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .cardStyle()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}
