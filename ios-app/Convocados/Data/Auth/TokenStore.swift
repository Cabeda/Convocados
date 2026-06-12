import Foundation
import Security

final class TokenStore: ObservableObject {
    static let shared = TokenStore()

    @Published private(set) var isAuthenticated: Bool = false

    private let accessTokenKey = "dev.convocados.ios.accessToken"
    private let refreshTokenKey = "dev.convocados.ios.refreshToken"
    private let expiryKey = "dev.convocados.ios.tokenExpiry"

    private let lock = NSLock()

    init() {
        isAuthenticated = accessToken != nil
    }

    var accessToken: String? {
        lock.lock()
        defer { lock.unlock() }
        return readKeychain(key: accessTokenKey)
    }

    var refreshToken: String? {
        lock.lock()
        defer { lock.unlock() }
        return readKeychain(key: refreshTokenKey)
    }

    var tokenExpiry: Date? {
        lock.lock()
        defer { lock.unlock() }
        guard let str = readKeychain(key: expiryKey),
              let interval = TimeInterval(str) else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    var isTokenExpired: Bool {
        guard let expiry = tokenExpiry else { return true }
        return Date() >= expiry
    }

    func store(accessToken: String, refreshToken: String?, expiresIn: Int) {
        lock.lock()
        writeKeychain(key: accessTokenKey, value: accessToken)
        if let rt = refreshToken {
            writeKeychain(key: refreshTokenKey, value: rt)
        }
        let expiry = Date().addingTimeInterval(TimeInterval(expiresIn))
        writeKeychain(key: expiryKey, value: String(expiry.timeIntervalSince1970))
        lock.unlock()

        DispatchQueue.main.async {
            self.isAuthenticated = true
        }
    }

    func clear() {
        lock.lock()
        deleteKeychain(key: accessTokenKey)
        deleteKeychain(key: refreshTokenKey)
        deleteKeychain(key: expiryKey)
        lock.unlock()

        DispatchQueue.main.async {
            self.isAuthenticated = false
        }
    }

    // MARK: - Keychain Helpers

    private func writeKeychain(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)

        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attrs as CFDictionary, nil)
    }

    private func readKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
