import Foundation

final class SettingsStore: ObservableObject {
    private let defaults = UserDefaults.standard

    @Published var serverUrl: String {
        didSet { defaults.set(serverUrl, forKey: "serverUrl") }
    }

    @Published var locale: String {
        didSet { defaults.set(locale, forKey: "locale") }
    }

    @Published var themeMode: ThemeMode {
        didSet { defaults.set(themeMode.rawValue, forKey: "themeMode") }
    }

    init() {
        self.serverUrl = defaults.string(forKey: "serverUrl") ?? "https://convocados.cabeda.dev"
        self.locale = defaults.string(forKey: "locale") ?? "en"
        self.themeMode = ThemeMode(rawValue: defaults.string(forKey: "themeMode") ?? "system") ?? .system
    }
}

enum ThemeMode: String, CaseIterable {
    case system
    case light
    case dark
}
