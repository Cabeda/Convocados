import SwiftUI

struct GamesView: View {
    @StateObject private var viewModel: GamesViewModel
    @EnvironmentObject private var apiClient: APIClient
    @State private var selectedTab = 0

    init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: GamesViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Games", selection: $selectedTab) {
                    Text("My Games").tag(0)
                    Text("Following").tag(1)
                    Text("Archived").tag(2)
                }
                .pickerStyle(.segmented)
                .padding()

                Group {
                    switch selectedTab {
                    case 0: gamesList(viewModel.myGames + viewModel.adminGames)
                    case 1: gamesList(viewModel.followedGames)
                    case 2: gamesList(viewModel.archivedGames)
                    default: EmptyView()
                    }
                }
            }
            .navigationTitle("Games")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink(destination: CreateEventView(apiClient: apiClient)) {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable { await viewModel.loadGames() }
            .task { await viewModel.loadGames() }
            .alert("Error", isPresented: .constant(viewModel.error != nil)) {
                Button("OK") { viewModel.error = nil }
            } message: {
                Text(viewModel.error ?? "")
            }
        }
    }

    @ViewBuilder
    private func gamesList(_ games: [EventSummary]) -> some View {
        if viewModel.isLoading && games.isEmpty {
            ProgressView()
                .frame(maxHeight: .infinity)
        } else if games.isEmpty {
            ContentUnavailableView("No games", systemImage: "sportscourt", description: Text("Create or join a game to get started"))
        } else {
            List(games) { game in
                NavigationLink(destination: EventDetailView(eventId: game.id, apiClient: apiClient)) {
                    GameCard(event: game)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task {
                            _ = try? await apiClient.archiveEvent(eventId: game.id)
                            await viewModel.loadGames()
                        }
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                }
            }
            .listStyle(.plain)
        }
    }
}
