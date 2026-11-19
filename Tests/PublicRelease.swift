import Cocoa
import XCTest

final class PublicReleaseTests: XCTestCase {
    let path = "/Applications/Masame.app"

    private func version() throws -> String {
        let url = URL(fileURLWithPath: path).appendingPathComponent("Contents/Info.plist")
        let dict = try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any]
        return try XCTUnwrap(dict?["CFBundleShortVersionString"] as? String)
    }

    private func pids() -> [pid_t] {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.sylvainrey.masame")
            .filter { !$0.isTerminated && $0.bundleURL?.path == path }
            .map(\.processIdentifier)
    }

    private func button(_ app: XCUIApplication, _ labels: [String], prefix: Bool = false) -> XCUIElement {
        let format = prefix ? "label BEGINSWITH[c] %@ OR title BEGINSWITH[c] %@" : "label =[c] %@ OR title =[c] %@"
        let predicate = NSCompoundPredicate(orPredicateWithSubpredicates: labels.map {
            NSPredicate(format: format, $0, $0)
        })
        return app.buttons.matching(predicate).firstMatch
    }

    private func openSettings(_ app: XCUIApplication) throws {
        let settings = button(app, ["Settings", "Réglages", "Paramètres"], prefix: true)
        if !settings.waitForExistence(timeout: 45) {
            print(String(app.debugDescription.prefix(18000)))
            XCTFail("Masame Settings control was missing")
            throw NSError(domain: "Settings", code: 1)
        }
        settings.click()
    }

    private func clickUpdateButton(_ control: XCUIElement, in app: XCUIApplication) {
        // Scroll the settings sheet under the update control if WebKit exposes its offscreen frame.
        for _ in 0..<18 {
            if control.isHittable { break }
            let area = app.windows.firstMatch
            area.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.65))
                .scroll(byDeltaX: 0, deltaY: -320)
        }
        control.click()
    }

    func testInstalledApplicationOpens() throws {
        let app = XCUIApplication(url: URL(fileURLWithPath: path))
        app.activate()
        try openSettings(app)
        print("Installed DMG application showed its settings, version", try version(), "PID", pids())
    }

    func testPublicUpdate() throws {
        XCTAssertEqual(try version(), "0.8.0")
        let app = XCUIApplication(url: URL(fileURLWithPath: path))
        app.activate()
        let oldPid = try XCTUnwrap(pids().first)
        try openSettings(app)
        let install = button(app, ["Install", "Installer"])
        if !install.waitForExistence(timeout: 8) {
            let check = button(app, ["Check for updates", "Rechercher les mises à jour"])
            if check.waitForExistence(timeout: 10) { clickUpdateButton(check, in: app) }
        }
        guard install.waitForExistence(timeout: 45) else {
            print(String(app.debugDescription.suffix(24000)))
            return XCTFail("No update was offered by 0.8.0")
        }
        print("Public 0.8.0 PID", oldPid, "offers Install")
        clickUpdateButton(install, in: app)
        let end = Date().addingTimeInterval(150)
        while Date() < end {
            if (try? version()) == "0.8.1", let pid = pids().first(where: { $0 != oldPid }) {
                let restarted = XCUIApplication(url: URL(fileURLWithPath: path))
                XCTAssertTrue(restarted.windows.firstMatch.waitForExistence(timeout: 35))
                let settings = button(restarted, ["Settings", "Réglages", "Paramètres"], prefix: true)
                XCTAssertTrue(settings.waitForExistence(timeout: 35))
                print("Updated app 0.8.1 relaunched from the same path, PID", pid, "and displayed the board")
                return
            }
            Thread.sleep(forTimeInterval: 1)
        }
        print("Installed version", try version(), "PIDs", pids())
        print(String(app.debugDescription.suffix(20000)))
        XCTFail("Update or automatic restart did not complete")
    }
}
