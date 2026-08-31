import Cocoa
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?
    var logHandle: FileHandle?

    let serverURL = "http://127.0.0.1:8765"

    func applicationDidFinishLaunching(_ notification: Notification) {
        createWindow()

        if !serverAvailable() && ProcessInfo.processInfo.environment["PLOTTER_STUDIO_BACKEND_READY"] == nil {
            startServer()
            waitForServer()
        } else if !serverAvailable() {
            waitForServer()
        }

        if serverAvailable(), let url = URL(string: "\(serverURL)?v=pen-lift-1") {
            webView.load(URLRequest(url: url))
        } else {
            showMessage(
                title: "Plotter Studio could not start",
                body: "Check .plotter-app/desktop.log in the project folder."
            )
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate()
        try? logHandle?.close()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func createWindow() {
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.loadHTMLString(
            """
            <!doctype html>
            <html>
              <body style="margin:0;display:grid;place-items:center;height:100vh;background:#e9ecef;font:15px -apple-system;color:#1f2933">
                <div>Starting Plotter Studio...</div>
              </body>
            </html>
            """,
            baseURL: nil
        )

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Plotter Studio"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    func repoRoot() -> URL? {
        let appParent = Bundle.main.bundleURL.deletingLastPathComponent()
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let candidates = [
            appParent.appendingPathComponent("firmware", isDirectory: true),
            appParent,
            cwd.appendingPathComponent("firmware", isDirectory: true),
            cwd
        ]

        return candidates.first { root in
            FileManager.default.fileExists(
                atPath: root.appendingPathComponent("tools/plotter_studio.py").path
            )
        }
    }

    func serverAvailable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        process.arguments = ["-fsS", "--max-time", "1", "\(serverURL)/api/status"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    func startServer() {
        guard let root = repoRoot() else {
            showMessage(
                title: "Plotter Studio could not find firmware",
                body: "Move Plotter Studio.app back into the pen-plotter repo folder, next to the firmware folder."
            )
            return
        }

        let dataDir = root.appendingPathComponent(".plotter-app", isDirectory: true)
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)

        let logURL = dataDir.appendingPathComponent("desktop.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        logHandle = try? FileHandle(forWritingTo: logURL)
        _ = try? logHandle?.seekToEnd()
        writeLog("starting Plotter Studio from \(root.path)")

        let python = root.appendingPathComponent(".venv/bin/python")
        let server = root.appendingPathComponent("tools/plotter_studio.py")
        writeLog("launching backend with \(python.path) \(server.path)")
        let process = Process()
        process.executableURL = python
        process.arguments = [server.path]
        process.currentDirectoryURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
        process.environment = [
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONUNBUFFERED": "1"
        ]
        if let handle = logHandle {
            process.standardOutput = handle
            process.standardError = handle
        }

        do {
            try process.run()
            serverProcess = process
            writeLog("backend process started, pid \(process.processIdentifier)")
        } catch {
            writeLog("backend launch failed: \(error.localizedDescription)")
            showMessage(title: "Could not launch backend", body: "\(error.localizedDescription)\n\nLog: \(logURL.path)")
        }
    }

    func writeLog(_ message: String) {
        let line = "[desktop] \(message)\n"
        if let data = line.data(using: .utf8) {
            try? logHandle?.write(contentsOf: data)
        }
    }

    func runCommand(executable: String, arguments: [String], cwd: URL) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = cwd
        if let handle = logHandle {
            process.standardOutput = handle
            process.standardError = handle
        }

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            return 127
        }
    }

    func waitForServer() {
        for _ in 0..<45 {
            if serverAvailable() {
                return
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = ["svg", "png", "jpg", "jpeg", "gif", "bmp", "webp"].compactMap {
            UTType(filenameExtension: $0)
        }

        if let window = window {
            panel.beginSheetModal(for: window) { response in
                completionHandler(response == .OK ? panel.urls : nil)
            }
        } else {
            let response = panel.runModal()
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func showMessage(title: String, body: String) {
        webView.loadHTMLString(
            """
            <!doctype html>
            <html>
              <body style="margin:0;display:grid;place-items:center;height:100vh;background:#e9ecef;font:15px -apple-system;color:#1f2933">
                <main style="max-width:520px;padding:24px">
                  <h1 style="font-size:22px;margin:0 0 10px">\(title)</h1>
                  <p style="line-height:1.45">\(body)</p>
                </main>
              </body>
            </html>
            """,
            baseURL: nil
        )
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
