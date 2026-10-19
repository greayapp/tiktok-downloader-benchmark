// The test bundle needs a host app; the tests drive Safari, not this app.
import SwiftUI

@main
struct HostApp: App {
    var body: some Scene {
        WindowGroup { Text("TikTok Downloader Benchmark — iPhone check host") }
    }
}
