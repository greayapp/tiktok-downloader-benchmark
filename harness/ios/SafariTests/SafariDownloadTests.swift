// Drives Safari on the simulator like a person (SPEC.md §5.1, §6.F "iPhone
// check"): open the tool, paste the link, tap submit, tap the download control,
// accept Safari's download prompt. Reports what happened on lines starting
// "TDB_RESULT:"; src/iphone.mjs then checks the file landed on the device.
import XCTest

final class SafariDownloadTests: XCTestCase {
    private func report(_ key: String, _ value: String) { print("TDB_RESULT: \(key)=\(value)") }

    private func firstMatch(_ query: XCUIElementQuery, labels: [String], timeout: TimeInterval) -> XCUIElement? {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            for raw in labels {
                let p = NSPredicate(format: "label CONTAINS[c] %@", raw)
                let el = query.matching(p).firstMatch
                if el.exists && el.isHittable { return el }
            }
            Thread.sleep(forTimeInterval: 1)
        } while Date() < end
        return nil
    }

    func testDownloadInSafari() throws {
        let env = ProcessInfo.processInfo.environment
        guard let tool = env["TDB_TOOL_URL"], let link = env["TDB_TIKTOK_URL"] else { XCTFail("TDB_TOOL_URL / TDB_TIKTOK_URL missing"); return }
        let controlLabels = (env["TDB_LABELS"] ?? "no watermark|without watermark|HD|Download").split(separator: "|").map(String.init)
        let submitLabels = (env["TDB_SUBMIT"] ?? "Download|Submit|Start|Search|Get video|Go").split(separator: "|").map(String.init)

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCUIDevice.shared.system.open(URL(string: tool)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        sleep(6)

        // Paste the link into the page's first text field.
        let fields = safari.webViews.textFields.allElementsBoundByIndex + safari.webViews.searchFields.allElementsBoundByIndex
        guard let field = fields.first(where: { $0.exists && $0.isHittable }) else { report("outcome", "failure"); report("reason", "no link box"); return }
        field.tap()
        field.typeText(link)

        // Submit.
        if let submit = firstMatch(safari.webViews.buttons, labels: submitLabels, timeout: 5) { submit.tap() }
        else { safari.keyboards.buttons["Go"].firstMatch.tap() }
        report("submitted", "yes")

        // The download control.
        let controls = safari.webViews.descendants(matching: .any).matching(NSPredicate(format: "elementType == %d OR elementType == %d", XCUIElement.ElementType.link.rawValue, XCUIElement.ElementType.button.rawValue))
        guard let control = firstMatch(controls, labels: controlLabels, timeout: 60) else { report("outcome", "failure"); report("reason", "no download control within 60 s"); return }
        report("control", control.label.replacingOccurrences(of: "\n", with: " "))
        control.tap()

        // Safari asks before downloading (an alert or sheet, not the web page);
        // accept like a person.
        // iOS 18 shows it as a popover: "Do you want to download …?" with
        // View / Download. Its Download button is the one just below that text.
        var accepted = false
        let promptEnd = Date().addingTimeInterval(15)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        while !accepted && Date() < promptEnd {
            for app in [safari, springboard] {
                let question = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "want to download")).firstMatch
                guard question.exists else { continue }
                report("prompt_text", question.label.replacingOccurrences(of: "\n", with: " "))
                let q = question.frame
                let candidates = app.buttons.matching(NSPredicate(format: "label == %@", "Download")).allElementsBoundByIndex
                if let button = candidates.first(where: { $0.isHittable && $0.frame.midY > q.minY - 20 && $0.frame.midY < q.maxY + 160 }) {
                    button.tap()
                    accepted = true
                    break
                }
            }
            if !accepted { Thread.sleep(forTimeInterval: 1) }
        }
        report("prompt", accepted ? "accepted" : "none")
        if !accepted && env["TDB_DEBUG"] == "1" {
            for (name, app) in [("safari", safari), ("springboard", XCUIApplication(bundleIdentifier: "com.apple.springboard"))] {
                for line in app.debugDescription.split(separator: "\n") where line.localizedCaseInsensitiveContains("want to download") || line.contains("'View'") || line.contains("Alert") || line.contains("Popover") || line.contains("Sheet") {
                    print("TDB_TREE[\(name)]: \(line)")
                }
            }
        }
        sleep(25) // let the download finish; the host checks the file
        report("outcome", "tapped")
    }
}
