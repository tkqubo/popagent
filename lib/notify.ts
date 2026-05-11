/**
 * iTerm2 auto-attach.
 */
import type { Logger } from "./log.ts";
import { runSync } from "./process.ts";
import { whichSync } from "./shell.ts";

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
