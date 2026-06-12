import SwiftUI

struct CreateEventView: View {
    @StateObject private var viewModel: CreateEventViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?

    enum Field { case title, location, maxPlayers }

    init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: CreateEventViewModel(apiClient: apiClient))
    }

    var body: some View {
        Form {
            Section(header: Text("Details")) {
                TextField("Title", text: $viewModel.title)
                    .focused($focusedField, equals: .title)
                    .textContentType(.organizationName)

                TextField("Location (optional)", text: $viewModel.location)
                    .focused($focusedField, equals: .location)
                    .textContentType(.fullStreetAddress)

                DatePicker("Date & Time", selection: $viewModel.dateTime, in: Date()...)

                Picker("Sport", selection: $viewModel.sport) {
                    Text("Football").tag("football")
                    Text("Futsal").tag("futsal")
                    Text("Basketball").tag("basketball")
                    Text("Padel").tag("padel")
                    Text("Tennis").tag("tennis")
                    Text("Volleyball").tag("volleyball")
                    Text("Other").tag("other")
                }
            }

            Section(header: Text("Settings")) {
                Stepper("Max Players: \(viewModel.maxPlayers)", value: $viewModel.maxPlayers, in: 2...100)

                Toggle("Recurring", isOn: $viewModel.isRecurring)

                if viewModel.isRecurring {
                    Picker("Frequency", selection: $viewModel.recurrenceFreq) {
                        Text("Weekly").tag("weekly")
                        Text("Biweekly").tag("biweekly")
                        Text("Monthly").tag("monthly")
                    }
                }
            }

            Section {
                Button(action: {
                    Task {
                        let success = await viewModel.createEvent()
                        if success { dismiss() }
                    }
                }) {
                    if viewModel.isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Create Event")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                }
                .disabled(viewModel.title.isEmpty || viewModel.isLoading)
            }
        }
        .navigationTitle("New Event")
        .alert("Error", isPresented: .constant(viewModel.error != nil)) {
            Button("OK") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }
}
