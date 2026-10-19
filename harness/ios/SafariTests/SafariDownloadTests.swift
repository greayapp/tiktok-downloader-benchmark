// Drives Safari on the simulator like a person (SPEC.md §5.1, §6.F "iPhone
// check"): open the tool, paste the link, tap submit, tap the download control,
// accept Safari's download prompt. Reports what happened on lines starting
// "TDB_RESULT:"; src/iphone.mjs then checks the file landed on the device.
//
// The page's links and buttons are read from one snapshot of the accessibility
// tree per check (reading them one by one takes minutes on long pages); an
// element is resolved only when it is tapped.
import XCTest

final class SafariDownloadTests: XCTestCase {
    private func report(_ key: String, _ value: String) { print("TDB_RESULT: \(key)=\(value.replacingOccurrences(of: "\n", with: " "))") }

    /// A link or button as the snapshot saw it.
    struct Control { let type: XCUIElement.ElementType; let label: String; let frame: CGRect }

    /// Ads are never tapped (anything labelled as sponsored or an ad), nor controls a visitor wouldn't
    /// pick for the download (start over, share, app installs) — as on desktop (flow.mjs).
    private func isExcluded(_ label: String) -> Bool {
        label.range(of: "sponsored|advert|\\bads?\\b|ads by|shopping|^go to |learn more|app store|google play|install|another|again|new video|share|copy", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// An element's place on the page: label and position. The submit button and a result button can
    /// share a label ("Download"); they never share a place.
    private func key(_ c: Control) -> String {
        "\(c.label)|\(Int(c.frame.minX))|\(Int(c.frame.minY))|\(Int(c.frame.width))|\(Int(c.frame.height))"
    }

    /// Every visible-size link and button in Safari's web views, from one snapshot each.
    private func controls(_ safari: XCUIApplication) -> [Control] {
        var out: [Control] = []
        func walk(_ s: XCUIElementSnapshot) {
            if (s.elementType == .link || s.elementType == .button) && s.frame.width > 0 && s.frame.height > 0 {
                out.append(Control(type: s.elementType, label: s.label, frame: s.frame))
            }
            for c in s.children { walk(c) }
        }
        for wv in safari.webViews.allElementsBoundByIndex {
            if let snap = try? wv.snapshot() { walk(snap) }
        }
        return out
    }

    /// The live element for a snapshot entry: same type and label, nearest to where it was.
    private func element(_ c: Control, _ safari: XCUIApplication) -> XCUIElement? {
        let same = safari.webViews.descendants(matching: c.type).matching(NSPredicate(format: "label == %@", c.label)).allElementsBoundByIndex
        return same.min(by: { abs($0.frame.minY - c.frame.minY) + abs($0.frame.minX - c.frame.minX) < abs($1.frame.minY - c.frame.minY) + abs($1.frame.minX - c.frame.minX) })
    }

    /// What was on the page before submitting: how many controls carry each label, and where.
    struct Before { var counts: [String: Int] = [:]; var keys: Set<String> = [] }

    /// The first control whose label contains one of `labels` (in that order of preference), isn't
    /// excluded, and is new since `before`: its label is carried by more controls than before (pages
    /// shift after submitting, so a new position alone doesn't make a control new), and it isn't at a
    /// place a control with that label already had. Among several, the lowest on the page.
    private func newControl(_ safari: XCUIApplication, labels: [String], timeout: TimeInterval, before: Before) -> Control? {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            let now = controls(safari)
            var counts: [String: Int] = [:]
            for c in now { counts[c.label, default: 0] += 1 }
            for raw in labels {
                let hits = now.filter { c in
                    c.label.range(of: raw, options: .caseInsensitive) != nil && !isExcluded(c.label) && !c.label.hasSuffix("?") && c.label.count <= 80
                        && (counts[c.label] ?? 0) > (before.counts[c.label] ?? 0) && !before.keys.contains(key(c))
                }
                if let c = hits.max(by: { $0.frame.minY < $1.frame.minY }) { return c }
            }
            Thread.sleep(forTimeInterval: 1)
        } while Date() < end
        return nil
    }

    /// Scrolls the page (dragging in the upper half, above any bottom-anchored ad) until `el` sits in
    /// the upper middle of the screen, where a person would bring it before tapping; then taps that
    /// point on screen, so whatever covers it gets the tap — as in the desktop flow (clickLikeUser).
    private func tapLikeUser(_ el: XCUIElement, _ safari: XCUIApplication) {
        let web = safari.webViews.firstMatch
        if web.exists {
            let wf = web.frame
            for _ in 0..<10 {
                let y = el.frame.midY
                if y >= wf.minY + wf.height * 0.2 && y <= wf.minY + wf.height * 0.5 { break }
                let dy = max(-wf.height * 0.3, min(wf.height * 0.3, y - (wf.minY + wf.height * 0.35)))
                let from = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: wf.height * 0.45))
                from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -dy)))
                Thread.sleep(forTimeInterval: 0.8)
            }
        }
        el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    /// Back, like a visitor: the toolbar's Back button, or (toolbar collapsed) Safari's edge swipe.
    private func goBack(_ safari: XCUIApplication) {
        let back = safari.buttons["BackButton"]
        if back.exists && back.isHittable && back.isEnabled { back.tap() }
        else { safari.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)).press(forDuration: 0.05, thenDragTo: safari.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))) }
        sleep(3)
    }

    /// The host Safari shows, if it shows one.
    private func shownHost(_ safari: XCUIApplication) -> String? {
        let address = safari.descendants(matching: .any).matching(identifier: "TabBarItemTitle").firstMatch
        guard address.exists, let shown = address.value as? String, !shown.isEmpty else { return nil }
        return shown
    }

    /// A close control of an ad layer or modal covering the page ("Close", "Close ad", "Dismiss", "Skip", "×").
    private func closeControl(_ safari: XCUIApplication) -> XCUIElement? {
        let p = NSPredicate(format: "label ==[c] 'close' OR label ==[c] 'close ad' OR label BEGINSWITH[c] 'dismiss' OR label ==[c] 'skip' OR label ==[c] 'skip ad' OR label == '×' OR label == '✕'")
        return safari.webViews.descendants(matching: .any).matching(p).allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable })
    }

    /// Safari asks before downloading (not the web page): iOS 18 shows a popover "Do you want to
    /// download …?" with View / Download. Taps its Download button, the one just below that text.
    private func acceptPrompt(apps: [XCUIApplication], timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            for app in apps {
                // Safari's own wording; page text like "Want to download videos from…" isn't the prompt.
                let question = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Do you want to download")).firstMatch
                guard question.exists else { continue }
                report("prompt_text", question.label)
                let q = question.frame
                let candidates = app.buttons.matching(NSPredicate(format: "label == %@", "Download")).allElementsBoundByIndex
                if let button = candidates.first(where: { $0.isHittable && $0.frame.midY > q.minY - 20 && $0.frame.midY < q.maxY + 160 }) {
                    button.tap()
                    return true
                }
            }
            Thread.sleep(forTimeInterval: 1)
        }
        return false
    }

    func testDownloadInSafari() throws {
        let env = ProcessInfo.processInfo.environment
        guard let tool = env["TDB_TOOL_URL"], let link = env["TDB_TIKTOK_URL"] else { XCTFail("TDB_TOOL_URL / TDB_TIKTOK_URL missing"); return }
        let controlLabels = (env["TDB_LABELS"] ?? "no watermark|without watermark|HD|MP4|Download video|Download").split(separator: "|").map(String.init)
        let submitLabels = (env["TDB_SUBMIT"] ?? "Download|Submit|Start|Search|Get video|Go").split(separator: "|").map(String.init)

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCUIDevice.shared.system.open(URL(string: tool)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))

        // The page's link box: its first text field (a slow page gets up to 30 s to show it).
        var found: XCUIElement? = nil
        let fieldEnd = Date().addingTimeInterval(30)
        sleep(4)
        while found == nil && Date() < fieldEnd {
            let fields = safari.webViews.textFields.allElementsBoundByIndex + safari.webViews.searchFields.allElementsBoundByIndex + safari.webViews.textViews.allElementsBoundByIndex
            found = fields.first(where: { $0.exists && $0.isHittable }) ?? fields.first(where: { $0.exists && $0.frame.width > 40 })
            if found == nil { sleep(1) }
        }
        guard let field = found else { report("outcome", "failure"); report("reason", "no link box within 30 s"); return }
        sleep(2)

        // Tap into the box; if an ad layer took the tap, close it and tap the box again (as on desktop).
        let toolHost = URL(string: tool)?.host?.replacingOccurrences(of: "www.", with: "") ?? tool
        var focused = false
        for _ in 0..<3 {
            if field.exists { tapLikeUser(field, safari) }
            sleep(1)
            if safari.keyboards.firstMatch.exists || (field.exists && (field.value(forKey: "hasKeyboardFocus") as? Bool) == true) { focused = true; break }
            // An ad took the tap: back to the tool, or close the layer, then tap the box again.
            if let shown = shownHost(safari), !shown.contains(toolHost) { report("left_site", shown); goBack(safari) }
            if let close = closeControl(safari) { report("closed_overlay", close.label); close.tap(); sleep(1) }
        }
        // An ad wall ("view a short ad to continue") is recorded, never watched (SPEC.md §5.2).
        let wall = safari.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'view a short ad' OR label CONTAINS[c] 'unlock more content' OR label CONTAINS[c] 'watch an ad'")).firstMatch
        if !focused && wall.exists { report("outcome", "ad-wall"); report("reason", "an ad wall covers the page (watch an ad to continue — not done)"); return }
        guard focused else { report("outcome", "failure"); report("reason", "the link box never took the typing (taps landed elsewhere)"); return }
        field.typeText(link)

        // What is on the page before submitting (navigation, ads already shown) is not the result.
        let pageBefore = controls(safari)
        var before = Before()
        for c in pageBefore { before.counts[c.label, default: 0] += 1; before.keys.insert(key(c)) }

        // Submit: the matching button nearest the link box (as on desktop: generic.mjs findSubmit).
        let fieldFrame = field.frame
        let submits = pageBefore.filter { c in
            c.type == .button && !isExcluded(c.label) && submitLabels.contains { c.label.range(of: $0, options: .caseInsensitive) != nil }
                && abs(c.frame.midY - fieldFrame.midY) < 400
        }
        if let s = submits.min(by: { abs($0.frame.midY - fieldFrame.midY) < abs($1.frame.midY - fieldFrame.midY) }), let el = element(s, safari) {
            tapLikeUser(el, safari)
        } else {
            safari.keyboards.buttons["Go"].firstMatch.tap()
        }
        report("submitted", "yes")

        // The download control. The task's specific options ("No watermark", "HD") first: for 20 s
        // nothing else is taken, so an ad's own "Download" button that loads before the result isn't
        // mistaken for it.
        let specific = Array(controlLabels.dropLast())
        guard let chosen = (specific.isEmpty ? nil : newControl(safari, labels: specific, timeout: 20, before: before))
                ?? newControl(safari, labels: controlLabels, timeout: 40, before: before) else { report("outcome", "failure"); report("reason", "no download control within 60 s"); return }
        report("control", chosen.label)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        // Tap the control and wait for Safari's download prompt. If an ad page or layer took the tap, a
        // visitor goes back or closes it with its own close control and taps again (SPEC.md §5.2): up to
        // four attempts, as on desktop, each extra tap counted.
        var accepted = false
        var taps = 0
        for attempt in 1...4 {
            if attempt > 1 {
                // An ad took the tap and Safari left the tool's site: go back, like a visitor.
                if let shown = shownHost(safari), !shown.contains(toolHost) {
                    report("left_site", shown)
                    goBack(safari)
                    taps += 1
                }
                if let close = closeControl(safari) {
                    report("closed_overlay", close.label)
                    close.tap()
                    taps += 1
                    // A Google vignette lets the tapped link go on once it is closed: wait before tapping again.
                    accepted = acceptPrompt(apps: [safari, springboard], timeout: 10)
                    if accepted { break }
                }
            }
            guard let target = element(chosen, safari), target.exists else { break }
            tapLikeUser(target, safari)
            taps += 1
            accepted = acceptPrompt(apps: [safari, springboard], timeout: 15)
            if accepted { break }
        }
        report("taps", "\(taps)")
        if let shown = shownHost(safari) { report("final_page", shown) }
        report("prompt", accepted ? "accepted" : "none")
        if !accepted && env["TDB_DEBUG"] == "1" {
            for c in controls(safari) where c.label.range(of: "close|dismiss|skip|download", options: [.regularExpression, .caseInsensitive]) != nil {
                print("TDB_CONTROL: type=\(c.type.rawValue) label=\(c.label) frame=\(c.frame)")
            }
        }
        sleep(25) // let the download finish; the host checks the file
        report("outcome", "tapped")
    }
}
