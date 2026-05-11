/**
 * The core of "pop": spin up tmux + iTerm2 + an AI agent for a given prompt.
 */
import type { Logger } from "./log.ts";
import { attachIterm } from "./notify.ts";
import { runSync, sleep } from "./process.ts";
import { shellQuote, whichSync } from "./shell.ts";

export interface PopOptions {
  /** Initial prompt passed to the agent */
  prompt: string;
  /** Working directory (absolute path) */
  cwd: string;
  /** tmux session name */
  sessionName: string;
  /** Sent as `/rename <title>` via tmux send-keys after launch */
  title?: string;
  log: Logger;
}

export type PopResult =
  | { ok: true; session: string; cwd: string }
  | { ok: false; error: string };

export async function pop(opts: PopOptions): Promise<PopResult> {
  const tmuxPath = whichSync("tmux");
  if (!tmuxPath) {
    return { ok: false, error: "tmux not found. Run `brew install tmux`." };
  }

  const escapedPrompt = shellQuote(opts.prompt);
  const claudeCmd = `claude ${escapedPrompt}`;
  const userShell = process.env.SHELL || "/bin/zsh";
  // Keep the tmux session alive after the agent exits by execing into a login shell.
  const wrappedCmd = `${claudeCmd}; exec ${shellQuote(userShell)} -l`;

  opts.log(
    "INFO",
    `tmux new-session: name=${opts.sessionName} cwd=${opts.cwd} cmd=${wrappedCmd}`,
  );
  const tmuxRes = runSync([
    tmuxPath, "new-session", "-d", "-s", opts.sessionName, "-c", opts.cwd, wrappedCmd,
  ]);
  if (tmuxRes.exitCode !== 0) {
    return {
      ok: false,
      error: `tmux launch failed (exit ${tmuxRes.exitCode}): ${tmuxRes.stderr.trim()}`,
    };
  }

  attachIterm(opts.sessionName, opts.log);

  // Wait for the agent UI to render, then send `/rename`.
  if (opts.title) {
    await sendRenameToSession(tmuxPath, opts.sessionName, opts.title, opts.log);
  }

  return { ok: true, session: opts.sessionName, cwd: opts.cwd };
}

/**
 * Send `/rename <title>` to the agent running inside the given tmux session.
 * Sleep first to give the agent time to render.
 */
async function sendRenameToSession(
  tmuxPath: string,
  session: string,
  title: string,
  log: Logger,
): Promise<void> {
  await sleep(2000);
  const renameCmd = `/rename ${title}`;
  log("INFO", `tmux send-keys: ${renameCmd}`);
  const r = runSync([tmuxPath, "send-keys", "-t", session, renameCmd, "Enter"]);
  if (r.exitCode !== 0) {
    log("WARN", `tmux send-keys failed: ${r.stderr.trim()}`);
  }
}
