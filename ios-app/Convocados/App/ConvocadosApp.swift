import SwiftUI

@main
struct ConvocadosApp: App {
    @StateObject private var tokenStore = TokenStore.shared
    @StateObject private var settings = SettingsStore()
    @StateObject private var apiClient: APIClient
    @StateObject private var authManager: AuthManager

    init() {
        let store = TokenStore.shared
        let settingsInstance = SettingsStore()
        let client = APIClient(tokenStore: store, settings: settingsInstance)
        let auth = AuthManager(tokenStore: store, settings: settingsInstance)
        client.setAuthManager(auth)

        _tokenStore = StateObject(wrappedValue: store)
        _settings = StateObject(wrappedValue: settingsInstance)
        _apiClient = StateObject(wrappedValue: client)
        _authManager = StateObject(wrappedValue: auth)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(tokenStore)
                .environmentObject(settings)
                .environmentObject(apiClient)
                .environmentObject(authManager)
                .onOpenURL { url in
                    authManager.handleCallback(url: url)
                }
                .preferredColorScheme(colorScheme)
        }
    }

    private var colorScheme: ColorScheme? {
        switch settings.themeMode {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
