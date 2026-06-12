import SwiftUI

struct RankingsView: View {
    let eventId: String
    @StateObject private var viewModel: RankingsViewModel

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        _viewModel = StateObject(wrappedValue: RankingsViewModel(eventId: eventId, apiClient: apiClient))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.ratings.isEmpty {
                ProgressView()
            } else if viewModel.ratings.isEmpty {
                ContentUnavailableView("No Rankings", systemImage: "chart.bar", description: Text("Play some games with ELO enabled"))
            } else {
                List {
                    ForEach(Array(viewModel.ratings.enumerated()), id: \.element.id) { index, rating in
                        HStack {
                            Text("\(index + 1)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(width: 28)

                            VStack(alignment: .leading) {
                                Text(rating.name).font(.body)
                                Text("\(rating.gamesPlayed) games • W:\(rating.wins) D:\(rating.draws) L:\(rating.losses)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            Text("\(rating.rating)")
                                .font(.headline)
                                .foregroundColor(.appPrimary)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Rankings")
        .refreshable { await viewModel.loadRatings() }
        .task { await viewModel.loadRatings() }
    }
}
