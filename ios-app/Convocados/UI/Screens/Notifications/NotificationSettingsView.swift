import SwiftUI

struct NotificationSettingsView: View {
    @State private var prefs: NotificationPrefs?
    @State private var isLoading = false
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var body: some View {
        Form {
            if let prefs = prefs {
                Section(header: Text("Push Notifications")) {
                    Toggle("Push Enabled", isOn: binding(for: "pushEnabled", value: prefs.pushEnabled))
                    Toggle("Player Activity", isOn: binding(for: "playerActivityPush", value: prefs.playerActivityPush))
                    Toggle("Event Details", isOn: binding(for: "eventDetailsPush", value: prefs.eventDetailsPush))
                    Toggle("Payment Reminders", isOn: binding(for: "paymentReminderPush", value: prefs.paymentReminderPush))
                }

                Section(header: Text("Reminders")) {
                    Toggle("24h Before", isOn: binding(for: "reminder24h", value: prefs.reminder24h))
                    Toggle("2h Before", isOn: binding(for: "reminder2h", value: prefs.reminder2h))
                    Toggle("1h Before", isOn: binding(for: "reminder1h", value: prefs.reminder1h))
                }

                Section(header: Text("Email")) {
                    Toggle("Email Enabled", isOn: binding(for: "emailEnabled", value: prefs.emailEnabled))
                    Toggle("Weekly Summary", isOn: binding(for: "weeklySummaryEmail", value: prefs.weeklySummaryEmail))
                }
            } else if isLoading {
                ProgressView()
            }
        }
        .navigationTitle("Notifications")
        .task {
            isLoading = true
            prefs = try? await apiClient.fetchNotificationPrefs()
            isLoading = false
        }
    }

    private func binding(for key: String, value: Bool) -> Binding<Bool> {
        Binding(
            get: { value },
            set: { newValue in
                Task {
                    prefs = try? await apiClient.updateNotificationPrefs([key: newValue])
                }
            }
        )
    }
}
