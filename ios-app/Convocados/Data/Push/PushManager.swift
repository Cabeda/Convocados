import Foundation
import UIKit
import UserNotifications

final class PushManager: NSObject, ObservableObject {
    @Published var isRegistered = false
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        super.init()
    }

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            DispatchQueue.main.async {
                self.isRegistered = granted
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    func sendTokenToServer(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        Task {
            struct Body: Codable { let token: String; let platform: String }
            let _: OkResponse = try await apiClient.post("/api/push/app-token", body: Body(token: token, platform: "ios"))
        }
    }
}
