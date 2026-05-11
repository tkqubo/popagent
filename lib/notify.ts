/**
 * macOS notifications and iTerm2 auto-attach.
 */
import type { Logger } from "./log.ts";
import { runSync } from "./process.ts";
import { applescriptQuote, shellQuote, whichSync } from "./shell.ts";

/**
 * Open a new iTerm2 window and run `tmux attach -t <session>`.
 *
 * iTerm2's `command` parameter is execvp'd directly, so we have to pass an
 * absolute path to tmux (no $PATH lookup). Bundle id is used to avoid
 * disambiguation issues with apps that happen to share a display name.
 */
export function attachIterm(session: string, log: Logger): void {
  const tmuxPath = whichSync("tmux") ?? "/opt/homebrew/bin/tmux";
  const applescript =
    `tell application id "com.googlecode.iterm2" to create window with default profile ` +
    `command "${tmuxPath} attach -t ${session}"`;
  log("INFO", `osascript: ${applescript}`);
  const r = runSync(["osascript", "-e", applescript], { timeoutMs: 10000 });
  const stdout = r.stdout.trim() || "(empty)";
  const stderr = r.stderr.trim() || "(empty)";
  log("INFO", `osascript result: exit=${r.exitCode} stdout=${stdout} stderr=${stderr}`);
  if (r.exitCode !== 0) {
    log("WARN", `iTerm auto-attach failed. Run \`tmux attach -t ${session}\` manually`);
  }
}

/**
 * terminal-notifier with a clickable -execute that brings up iTerm + tmux attach.
 *
 * On macOS Sonoma+, the notification may silently fail to display even with
 * exit code 0 (subprocess permission quirk). We still try, but document this
 * limitation.
 */
export function terminalNotifier(session: string, log: Logger): void {
  const applescript = `tell application "iTerm" to create window with default profile command "tmux attach -t ${session}"`;
  const executeCmd = `osascript -e ${shellQuote(applescript)}`;
  const args = [
    "terminal-notifier",
    "-title", "AI Agent Started",
    "-subtitle", "Agent session launched",
    "-message", "Click to attach in iTerm2",
    "-execute", executeCmd,
  ];
  log("INFO", `terminal-notifier: ${args.map(shellQuote).join(" ")}`);
  const r = runSync(args, { timeoutMs: 10000 });
  if (r.error) {
    log("WARN", `terminal-notifier not installed or errored: ${r.error.message}`);
    return;
  }
  const stderr = r.stderr.trim();
  const stdout = r.stdout.trim();
  log(
    "INFO",
    `terminal-notifier result: exit=${r.exitCode} stdout=${stdout || "(empty)"} stderr=${stderr || "(empty)"}`,
  );
  if (r.exitCode !== 0 || /error|invalid/i.test(stderr)) {
    log(
      "WARN",
      `terminal-notifier had issues. Click-to-attach may not work. Run \`tmux attach -t ${session}\` manually`,
    );
  }
}

/**
 * Show a macOS notification via `osascript display notification`.
 *
 * Clicking it opens Script Editor (a fundamental limitation of `display
 * notification`). Used as a fallback / non-interactive heads-up.
 */
export function osascriptNotify(
  title: string,
  subtitle: string,
  message: string,
  log: Logger,
): void {
  const script =
    `display notification ${applescriptQuote(message)} ` +
    `with title ${applescriptQuote(title)} ` +
    `subtitle ${applescriptQuote(subtitle)}`;
  const r = runSync(["osascript", "-e", script], { timeoutMs: 10000 });
  if (r.exitCode !== 0) {
    log("WARN", `osascript notify failed (exit=${r.exitCode}): ${r.stderr.trim()}`);
  }
}
