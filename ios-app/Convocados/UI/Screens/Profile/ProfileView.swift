import SwiftUI

struct ProfileView: View {
    @StateObject private var viewModel: ProfileViewModel
    @EnvironmentObject private var settings: SettingsStore
    @State private var showLogoutConfirmation = false

    init(apiClient: APIClient, authManager: AuthManager, settings: SettingsStore) {
        _viewModel = StateObject(wrappedValue: ProfileViewModel(apiClient: apiClient, authManager: authManager, settings: settings))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Account")) {
                    if let profile = viewModel.profile {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .font(.largeTitle)
                                .foregroundColor(.appPrimary)
                            VStack(alignment: .leading) {
                                Text(profile.name).font(.headline)
                                Text(profile.email).font(.caption).foregroundColor(.secondary)
                            }
                        }
                    }
                }

                Section(header: Text("Settings")) {
                    Picker("Theme", selection: $settings.themeMode) {
                        Text("System").tag(ThemeMode.system)
                        Text("Light").tag(ThemeMode.light)
                        Text("Dark").tag(ThemeMode.dark)
                    }

                    NavigationLink(destination: NotificationSettingsView(apiClient: viewModel.apiClient)) {
                        Label("Notifications", systemImage: "bell")
                    }
                }

                Section(header: Text("Server")) {
                    TextField("Server URL", text: $settings.serverUrl)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }

                Section {
                    Button(role: .destructive) {
                        showLogoutConfirmation = true
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("Profile")
            .refreshable { await viewModel.loadProfile() }
            .task { await viewModel.loadProfile() }
            .confirmationDialog("Sign out?", isPresented: $showLogoutConfirmation, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    Task { await viewModel.logout() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
