import SwiftUI

struct PaymentsView: View {
    let eventId: String
    @StateObject private var viewModel: PaymentsViewModel

    init(eventId: String, apiClient: APIClient) {
        self.eventId = eventId
        _viewModel = StateObject(wrappedValue: PaymentsViewModel(eventId: eventId, apiClient: apiClient))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.payments == nil {
                ProgressView()
            } else if let payments = viewModel.payments {
                List {
                    Section(header: Text("Summary")) {
                        HStack {
                            StatTile(label: "Paid", value: "\(payments.summary.paidCount)")
                            StatTile(label: "Pending", value: "\(payments.summary.pendingCount)")
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }

                    Section(header: Text("Players")) {
                        ForEach(payments.payments) { payment in
                            HStack {
                                Text(payment.playerName).font(.body)
                                Spacer()
                                statusBadge(payment.status)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            } else {
                ContentUnavailableView("No Payments", systemImage: "creditcard", description: Text("Enable split costs to track payments"))
            }
        }
        .navigationTitle("Payments")
        .refreshable { await viewModel.loadPayments() }
        .task { await viewModel.loadPayments() }
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        Text(status.capitalized)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(statusColor(status).opacity(0.2))
            .foregroundColor(statusColor(status))
            .cornerRadius(4)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "paid": return .green
        case "sent": return .orange
        default: return .secondary
        }
    }
}
