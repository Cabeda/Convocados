import SwiftUI

struct HistoryDetailView: View {
    let eventId: String
    @StateObject private var viewModel: HistoryDetailViewModel
    /// Players available as scorers for the add-goal picker, per history id.
    @State private var scorers: [String: [Player]] = [:]

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

                        MatchEventsRow(
                            game: game,
                            events: viewModel.matchEvents[game.id] ?? [],
                            scorers: scorers[game.id] ?? [],
                            onLoad: {
                                Task {
                                    await viewModel.loadMatchEvents(historyId: game.id)
                                    await loadScorers(historyId: game.id)
                                }
                            },
                            onAdd: { scorer, team, minute, count, ownGoal, penalty in
                                Task {
                                    await viewModel.addGoal(
                                        historyId: game.id,
                                        team: team,
                                        scorer: scorer,
                                        minute: minute,
                                        count: count,
                                        ownGoal: ownGoal,
                                        penalty: penalty
                                    )
                                }
                            },
                            onRemove: { id in
                                Task { await viewModel.removeGoal(historyId: game.id, matchEventId: id) }
                            }
                        )
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

    /// Resolve the event roster so the add-goal picker can offer scorers.
    private func loadScorers(historyId: String) async {
        if scorers[historyId] != nil { return }
        // The event detail carries the roster; reuse it rather than a new endpoint.
        do {
            let detail = try await viewModel.fetchEvent()
            scorers[historyId] = detail.players
        } catch {
            scorers[historyId] = []
        }
    }
}

/// Compact goal timeline + add/remove affordances for a settled game.
private struct MatchEventsRow: View {
    let game: GameHistory
    let events: [MatchEvent]
    let scorers: [Player]
    let onLoad: () -> Void
    let onAdd: (Player, String, Int?, Int, Bool, Bool) -> Void
    let onRemove: (String) -> Void

    @State private var showingAdd = false

    private var goals: [MatchEvent] { events.filter { $0.type == "goal" } }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Goals & assists")
                    .font(.caption)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    showingAdd = true
                } label: {
                    Label("Add goal", systemImage: "plus.circle")
                        .font(.caption)
                }
                .disabled(scorers.isEmpty)
            }

            if goals.isEmpty {
                Text("No goals logged yet.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            } else {
                ForEach(goals) { goal in
                    HStack(spacing: 6) {
                        Text(goal.minute != nil ? "\(goal.minute!)'" : "—")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .frame(width: 28, alignment: .leading)
                        Text(goal.scorerName)
                            .font(.caption)
                        if goal.ownGoal {
                            Text("Own goal").font(.caption2).foregroundColor(.secondary)
                        }
                        if let assist = goal.assistName, !assist.isEmpty {
                            Text("assist: \(assist)").font(.caption2).foregroundColor(.secondary)
                        }
                        if goal.count > 1 {
                            Text("×\(goal.count)").font(.caption2).foregroundColor(.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            onRemove(goal.id)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .onAppear(perform: onLoad)
        .sheet(isPresented: $showingAdd) {
            AddGoalSheet(scorers: scorers, teamOneName: game.teamOneName, teamTwoName: game.teamTwoName) { scorer, team, minute, count, ownGoal, penalty in
                onAdd(scorer, team, minute, count, ownGoal, penalty)
                showingAdd = false
            }
        }
    }
}

/// Minimal add-goal form: scorer, team, optional minute/details.
private struct AddGoalSheet: View {
    let scorers: [Player]
    let teamOneName: String
    let teamTwoName: String
    let onSubmit: (Player, String, Int?, Int, Bool, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var scorerId: String = ""
    @State private var team = "one"
    @State private var minuteText = ""
    @State private var count = 1
    @State private var ownGoal = false
    @State private var penalty = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Scorer") {
                    Picker("Scorer", selection: $scorerId) {
                        ForEach(scorers) { p in
                            Text(p.name).tag(p.id)
                        }
                    }
                }
                Section("Scoring team") {
                    Picker("Scoring team", selection: $team) {
                        Text(teamOneName).tag("one")
                        Text(teamTwoName).tag("two")
                    }
                    .pickerStyle(.segmented)
                }
                Section("Details") {
                    TextField("Minute (optional)", text: $minuteText)
                        .keyboardType(.numberPad)
                    Stepper("How many goals? \(count)", value: $count, in: 1...99)
                    Toggle("Own goal", isOn: $ownGoal)
                    Toggle("Penalty", isOn: $penalty)
                }
            }
            .navigationTitle("Add goal")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let scorer = scorers.first(where: { $0.id == scorerId }) ?? scorers.first else { return }
                        let minute = Int(minuteText)
                        onSubmit(scorer, team, minute, count, ownGoal, penalty)
                    }
                    .disabled(scorers.isEmpty)
                }
            }
        }
        .onAppear { scorerId = scorers.first?.id ?? "" }
    }
}
