import SwiftUI

struct PublicGamesView: View {
    @StateObject private var viewModel: PublicGamesViewModel
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: PublicGamesViewModel(apiClient: apiClient))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.events.isEmpty {
                ProgressView()
            } else if viewModel.events.isEmpty {
                ContentUnavailableView("No Public Games", systemImage: "globe", description: Text("No public games available right now"))
            } else {
                List(viewModel.filteredEvents) { event in
                    NavigationLink(destination: EventDetailView(eventId: event.id, apiClient: apiClient)) {
                        HStack {
                            SportIconView(sport: event.sport)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(event.title).font(.body).fontWeight(.medium)
                                if !event.location.isEmpty {
                                    Text(event.location).font(.caption).foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text("\(event.spotsLeft) spots")
                                    .font(.caption)
                                    .foregroundColor(event.spotsLeft > 0 ? .appPrimary : .secondary)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Public Games")
        .searchable(text: $viewModel.searchText, prompt: "Search games")
        .refreshable { await viewModel.loadPublicEvents() }
        .task { await viewModel.loadPublicEvents() }
    }
}
