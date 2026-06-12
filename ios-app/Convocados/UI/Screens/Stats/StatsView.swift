import SwiftUI

struct StatsView: View {
    @StateObject private var viewModel: StatsViewModel

    init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: StatsViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.stats == nil {
                    ProgressView()
                } else if let stats = viewModel.stats {
                    List {
                        Section(header: SectionHeader(title: "Summary", icon: "chart.bar")) {
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                                StatTile(label: "Games", value: "\(stats.summary.totalGames)")
                                StatTile(label: "Win Rate", value: String(format: "%.0f%%", stats.summary.winRate * 100))
                                StatTile(label: "Wins", value: "\(stats.summary.totalWins)")
                                StatTile(label: "Avg Rating", value: "\(stats.summary.avgRating)")
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                        }

                        if !stats.events.isEmpty {
                            Section(header: SectionHeader(title: "Per Event", icon: "list.bullet")) {
                                ForEach(stats.events, id: \.eventId) { event in
                                    HStack {
                                        VStack(alignment: .leading) {
                                            Text(event.eventTitle)
                                                .font(.body)
                                            Text("\(event.gamesPlayed) games • Rating: \(event.rating)")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        Spacer()
                                        Text(String(format: "%.0f%%", event.winRate * 100))
                                            .font(.subheadline)
                                            .foregroundColor(.appPrimary)
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                } else {
                    ContentUnavailableView("No Stats", systemImage: "chart.bar", description: Text("Play some games to see your stats"))
                }
            }
            .navigationTitle("Stats")
            .refreshable { await viewModel.loadStats() }
            .task { await viewModel.loadStats() }
        }
    }
}
