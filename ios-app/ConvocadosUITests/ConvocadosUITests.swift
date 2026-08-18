import XCTest

/// End-to-end UI test that mirrors a manual smoke test of the iOS app on the
/// simulator against a running local Convocados dev server.
///
/// Prerequisites (see ios-app/README.md "E2E tests"):
///   - A dev server reachable from the simulator, e.g. `npm run dev` on the
///     host (simulator shares the host loopback, so http://localhost:4321 works).
///   - A verified test user. By default the test uses ios@test.com /
///     TestPassword123. Override via launchEnvironment UITEST_EMAIL /
///     UITEST_PASSWORD.
///   - The `convocados-mobile-app` row must exist in `oauthClient` and the
///     user's email must be verified (see README).
final class ConvocadosUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func makeApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-serverUrl", "http://localhost:4321"]
        return app
    }

    func testLoginCreateAndOpenGame() throws {
        let app = makeApp()
        app.launch()

        // Sign in when logged out.
        if app.buttons["Sign In"].waitForExistence(timeout: 5) {
            let email = app.textFields["Email"]
            XCTAssertTrue(email.waitForExistence(timeout: 5))
            email.tap()
            email.typeText("ios@test.com")

            let password = app.secureTextFields["Password"]
            password.tap()
            password.typeText("TestPassword123")

            app.buttons["Sign In"].tap()
        }

        // Games screen loads.
        XCTAssertTrue(app.navigationBars["Games"].waitForExistence(timeout: 10),
                      "Expected to reach the Games screen after sign-in")

        // Create a game with a unique title.
        app.buttons["Add"].tap()
        XCTAssertTrue(app.staticTexts["New Event"].waitForExistence(timeout: 5))

        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        let gameTitle = "E2E Game \(Int(Date().timeIntervalSince1970))"
        title.typeText(gameTitle)

        app.buttons["Create Event"].tap()

        // Event appears in the My Games list.
        let cardTitle = app.staticTexts[gameTitle]
        XCTAssertTrue(cardTitle.waitForExistence(timeout: 10),
                      "Expected the created game to appear in the games list")

        // Open it and verify the detail screen renders.
        cardTitle.tap()
        XCTAssertTrue(app.staticTexts["Players: 0/10"].waitForExistence(timeout: 10),
                      "Expected the event detail header to render")
    }
}
