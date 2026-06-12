import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var tokenStore: TokenStore
    @EnvironmentObject private var authManager: AuthManager
    @EnvironmentObject private var apiClient: APIClient
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        if tokenStore.isAuthenticated {
            TabView {
                GamesView(apiClient: apiClient)
                    .tabItem {
                        Label("Games", systemImage: "sportscourt")
                    }

                StatsView(apiClient: apiClient)
                    .tabItem {
                        Label("Stats", systemImage: "chart.bar")
                    }

                ProfileView(apiClient: apiClient, authManager: authManager, settings: settings)
                    .tabItem {
                        Label("Profile", systemImage: "person")
                    }
            }
            .tint(.appPrimary)
        } else {
            LoginView(authManager: authManager)
        }
    }
}
