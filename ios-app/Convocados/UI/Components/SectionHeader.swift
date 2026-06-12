import SwiftUI

struct SectionHeader: View {
    let title: String
    var icon: String?

    var body: some View {
        HStack(spacing: 6) {
            if let icon = icon {
                Image(systemName: icon)
                    .foregroundColor(.appPrimary)
            }
            Text(title)
                .font(.headline)
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }
}
