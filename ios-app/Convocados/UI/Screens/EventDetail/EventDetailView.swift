import SwiftUI

struct EventDetailView: View {
    let eventId: String
    @StateObject private var viewModel: EventDetailViewModel
    @State private var newPlayerName = ""
    @FocusState private var isNameFieldFocused: Bool
    @State private var showShareSheet = false

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(eventId: eventId, apiClient: apiClient))
    }

    var body: some View {
        Group {
            if let event = viewModel.event {
                List {
                    headerSection(event)
                    teamsSection(event)
                    playersSection(event)
                    addPlayerSection(event)
                    actionsSection(event)
                }
                .listStyle(.insetGrouped)
            } else if viewModel.isLoading {
                ProgressView()
            } else if let error = viewModel.error {
                ContentUnavailableView("Error", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        }
        .navigationTitle(viewModel.event?.title ?? "Event")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(action: { showShareSheet = true }) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    if viewModel.event?.isAdmin == true {
                        Button(action: { Task { await viewModel.randomize(balanced: false) } }) {
                            Label("Randomize Teams", systemImage: "shuffle")
                        }
                        Button(action: { Task { await viewModel.randomize(balanced: true) } }) {
                            Label("Balanced Teams", systemImage: "scalemass")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .refreshable { await viewModel.loadEvent() }
        .task { await viewModel.loadEvent() }
        .sheet(isPresented: $showShareSheet) {
            if let event = viewModel.event {
                ShareLink(item: URL(string: viewModel.shareURL)!) {
                    Text("Share \(event.title)")
                }
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func headerSection(_ event: EventDetail) -> some View {
        Section {
            HStack {
                SportIconView(sport: event.sport)
                VStack(alignment: .leading, spacing: 4) {
                    if !event.location.isEmpty {
                        Label(event.location, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                    }
                    Label(event.dateTime, systemImage: "calendar")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }

            HStack {
                StatTile(label: "Players", value: "\(event.players.count)/\(event.maxPlayers)")
                if event.eloEnabled {
                    StatTile(label: "ELO", value: "On")
                }
            }
        }
    }

    @ViewBuilder
    private func teamsSection(_ event: EventDetail) -> some View {
        if let teams = event.teamResults, !teams.isEmpty {
            ForEach(teams) { team in
                Section(header: Text(team.name)) {
                    ForEach(team.members) { member in
                        Text(member.name)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func playersSection(_ event: EventDetail) -> some View {
        Section(header: SectionHeader(title: "Players", icon: "person.3")) {
            ForEach(event.players) { player in
                PlayerRow(player: player)
                    .swipeActions(edge: .trailing) {
                        if event.isAdmin {
                            Button(role: .destructive) {
                                Task { await viewModel.removePlayer(playerId: player.id) }
                            } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private func addPlayerSection(_ event: EventDetail) -> some View {
        if event.players.count < event.maxPlayers {
            Section {
                HStack {
                    TextField("Player name", text: $newPlayerName)
                        .focused($isNameFieldFocused)
                        .textContentType(.name)
                        .submitLabel(.done)
                        .onSubmit { addPlayer() }

                    Button(action: addPlayer) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.appPrimary)
                    }
                    .disabled(newPlayerName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    @ViewBuilder
    private func actionsSection(_ event: EventDetail) -> some View {
        Section {
            NavigationLink(destination: HistoryDetailView(eventId: event.id, apiClient: viewModel.apiClient)) {
                Label("History", systemImage: "clock.arrow.circlepath")
            }
            if event.eloEnabled {
                NavigationLink(destination: RankingsView(eventId: event.id, apiClient: viewModel.apiClient)) {
                    Label("Rankings", systemImage: "chart.bar")
                }
            }
            if event.splitCostsEnabled {
                NavigationLink(destination: PaymentsView(eventId: event.id, apiClient: viewModel.apiClient)) {
                    Label("Payments", systemImage: "creditcard")
                }
            }
        }
    }

    private func addPlayer() {
        let name = newPlayerName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        Task {
            await viewModel.addPlayer(name: name)
            newPlayerName = ""
            isNameFieldFocused = false
        }
    }
}
