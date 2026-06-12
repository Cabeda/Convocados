import SwiftUI

struct HistoryDetailView: View {
    let eventId: String
    @StateObject private var viewModel: HistoryDetailViewModel

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        _viewModel = StateObject(wrappedValue: HistoryDetailViewModel(eventId: eventId, apiClient: apiClient))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.history.isEmpty {
                ProgressView()
            } else if viewModel.history.isEmpty {
                ContentUnavailableView("No History", systemImage: "clock", description: Text("Game history will appear after team randomization"))
            } else {
                List(viewModel.history) { game in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(game.teamOneName)
                                .font(.subheadline)
                            Spacer()
                            if let s1 = game.scoreOne, let s2 = game.scoreTwo {
                                Text("\(s1) - \(s2)")
                                    .font(.headline)
                                    .foregroundColor(.appPrimary)
                            } else {
                                Text("No score")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text(game.teamTwoName)
                                .font(.subheadline)
                        }
                        Text(game.dateTime)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("History")
        .refreshable { await viewModel.loadHistory() }
        .task { await viewModel.loadHistory() }
    }
}
