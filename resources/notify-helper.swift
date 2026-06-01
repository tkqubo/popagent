import CoreFoundation
import Foundation
import UserNotifications

private let actionIdentifier = "POPAGENT_OPEN_ITERM"
private let categoryIdentifier = "POPAGENT_ATTACH_CATEGORY"

private struct Options {
  let session: String
  let tmuxPath: String
  let ttlSeconds: Int
  let launchScriptPath: String?
  let lazy: Bool
  let agentName: String
  let context: String?
}

private func parseOptions() -> Options? {
  let args = CommandLine.arguments
  var session: String?
  var tmuxPath = "/opt/homebrew/bin/tmux"
  var ttlSeconds = 600
  var launchScriptPath: String?
  var lazy = false
  var agentName = "AI Agent"
  var context: String?

  var index = 1
  while index < args.count {
    let arg = args[index]
    switch arg {
    case "--session":
      guard index + 1 < args.count else { return nil }
      session = args[index + 1]
      index += 2
    case "--tmux-path":
      guard index + 1 < args.count else { return nil }
      tmuxPath = args[index + 1]
      index += 2
    case "--ttl-seconds":
      guard index + 1 < args.count else { return nil }
      guard let parsed = Int(args[index + 1]), parsed > 0 else { return nil }
      ttlSeconds = parsed
      index += 2
    case "--launch-script":
      guard index + 1 < args.count else { return nil }
      launchScriptPath = args[index + 1]
      index += 2
    case "--lazy":
      lazy = true
      index += 1
    case "--agent-name":
      guard index + 1 < args.count else { return nil }
      agentName = args[index + 1]
      index += 2
    case "--context":
      guard index + 1 < args.count else { return nil }
      context = args[index + 1]
      index += 2
    default:
      index += 1
    }
  }

  guard let session, !session.isEmpty else { return nil }
  return Options(
    session: session,
    tmuxPath: tmuxPath,
    ttlSeconds: ttlSeconds,
    launchScriptPath: launchScriptPath,
    lazy: lazy,
    agentName: agentName,
    context: context
  )
}

private func escapeAppleScript(_ input: String) -> String {
  var out = ""
  for ch in input {
    if ch == "\\" || ch == "\"" {
      out.append("\\")
    }
    out.append(ch)
  }
  return out
}

private func openIterm(command: String) {
  let script =
    "tell application id \"com.googlecode.iterm2\" to create window with default profile command \""
    + escapeAppleScript(command) + "\""

  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  process.arguments = ["-e", script]
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    // Ignore callback-side failures. The CLI will still print manual attach instructions.
  }
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  private let defaultSession: String
  private let tmuxPath: String
  private let launchScriptPath: String?
  private let finish: () -> Void

  init(
    session: String,
    tmuxPath: String,
    launchScriptPath: String?,
    finish: @escaping () -> Void
  ) {
    self.defaultSession = session
    self.tmuxPath = tmuxPath
    self.launchScriptPath = launchScriptPath
    self.finish = finish
  }

  func userNotificationCenter(
    _: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    // Derive the action from the *clicked notification's* userInfo, not from
    // this process's launch arguments. Each notification spawns its own helper
    // instance, but all instances share one bundle id, so macOS can route a
    // click (or a rapid second click) to an instance that did not post that
    // notification. Reading session / tmux path / launch script from userInfo
    // guarantees we act on the notification the user actually clicked instead
    // of replaying this instance's own (possibly already-started) session.
    let responseSession = (info["popagentSession"] as? String) ?? defaultSession
    let responseTmuxPath = (info["popagentTmuxPath"] as? String) ?? tmuxPath
    let responseScript = (info["popagentLaunchScript"] as? String) ?? launchScriptPath
    defer {
      completionHandler()
      finish()
    }

    let action = response.actionIdentifier
    if action == UNNotificationDefaultActionIdentifier || action == actionIdentifier {
      // Lazy mode: run the prepared shell script (which itself spawns tmux + agent
      // before attaching). Eager mode: just attach to the already-running session.
      let command: String
      if let scriptPath = responseScript, !scriptPath.isEmpty {
        command = "/bin/sh " + scriptPath
      } else {
        command = responseTmuxPath + " attach -t " + responseSession
      }
      openIterm(command: command)
    }
  }

  func userNotificationCenter(
    _: UNUserNotificationCenter,
    willPresent _: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }
}

guard let opts = parseOptions() else {
  fputs(
    "usage: notify-helper --session <name> [--tmux-path <path>] [--ttl-seconds <n>] "
      + "[--launch-script <path>] [--lazy] [--agent-name <name>] [--context <text>]\n",
    stderr)
  exit(2)
}

let center = UNUserNotificationCenter.current()
let action = UNNotificationAction(
  identifier: actionIdentifier,
  title: "Open iTerm2",
  options: [.foreground]
)
let category = UNNotificationCategory(
  identifier: categoryIdentifier,
  actions: [action],
  intentIdentifiers: [],
  options: []
)
center.setNotificationCategories([category])

let authSemaphore = DispatchSemaphore(value: 0)
var authorized = false
let authOptions: UNAuthorizationOptions = [.alert, .sound, .badge]
center.requestAuthorization(options: authOptions) { granted, _ in
  authorized = granted
  authSemaphore.signal()
}
_ = authSemaphore.wait(timeout: .now() + 5)
guard authorized else {
  exit(1)
}

let lock = NSLock()
var done = false
let finish: () -> Void = {
  lock.lock()
  defer { lock.unlock() }
  if done { return }
  done = true
  CFRunLoopStop(CFRunLoopGetMain())
}

let delegate = NotificationDelegate(
  session: opts.session,
  tmuxPath: opts.tmuxPath,
  launchScriptPath: opts.launchScriptPath,
  finish: finish
)
center.delegate = delegate

let content = UNMutableNotificationContent()
content.title =
  opts.lazy
  ? "Click to start \(opts.agentName) session"
  : "\(opts.agentName) session started"
if let context = opts.context, !context.isEmpty {
  content.subtitle = context
}
content.body =
  opts.lazy
  ? "Click to start & attach in iTerm2"
  : "Click to attach in iTerm2"
content.sound = .default
if #available(macOS 12.0, *) {
  content.interruptionLevel = .active
  content.relevanceScore = 1.0
}
content.categoryIdentifier = categoryIdentifier
content.threadIdentifier = "popagent-" + opts.session
// Carry everything the click handler needs in userInfo so any helper instance
// that receives the click can act on *this* notification (see the delegate).
var userInfo: [String: Any] = [
  "popagentSession": opts.session,
  "popagentTmuxPath": opts.tmuxPath,
]
if let launchScriptPath = opts.launchScriptPath, !launchScriptPath.isEmpty {
  userInfo["popagentLaunchScript"] = launchScriptPath
}
content.userInfo = userInfo

let request = UNNotificationRequest(
  identifier: "popagent." + opts.session + "." + UUID().uuidString,
  content: content,
  trigger: nil
)

let addSemaphore = DispatchSemaphore(value: 0)
var addError: Error?
center.add(request) { error in
  addError = error
  addSemaphore.signal()
}
_ = addSemaphore.wait(timeout: .now() + 5)
guard addError == nil else {
  exit(1)
}

DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(opts.ttlSeconds)) {
  finish()
}

RunLoop.main.run()
