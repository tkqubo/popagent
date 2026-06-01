/**
 * The core of "pop": spin up tmux + iTerm2 + an AI agent for a given prompt.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSpec } from "./agent.ts";
import { attachIterm } from "./iterm.ts";
import type { Logger } from "./log.ts";
import { terminalNotifier } from "./notify.ts";
import { runSync, sleep } from "./process.ts";
import { shellQuote, whichSync } from "./shell.ts";

export interface PopOptions {
  /** Initial prompt passed to the agent */
  prompt: string;
  /** Agent to spawn */
  agent: AgentSpec;
  /** Working directory (absolute path) */
  cwd: string;
  /** tmux session name */
  sessionName: string;
  /** Sent as `/rename <title>` via tmux send-keys after launch */
  title?: string;
  /** When false, use notification helper instead of immediate iTerm auto-attach */
  autoAttach?: boolean;
  /** Defer tmux + agent startup until the user clicks the notification (requires autoAttach=false) */
  lazy?: boolean;
  /** Optional one-line subtitle for the notification (e.g. the comment summary). */
  notificationContext?: string;
  /**
   * Optional PR label (e.g. "PR #4298") shown in the notification title as
   * `<agent>: <label>`. When absent, the title falls back to the generic
   * "Click to start …" / "… started" wording.
   */
  notificationPrLabel?: string;
  log: Logger;
}

export type PopResult = { ok: true; session: string; cwd: string } | { ok: false; error: string };

export async function pop(opts: PopOptions): Promise<PopResult> {
  const tmuxPath = whichSync("tmux");
  if (!tmuxPath) {
    return { ok: false, error: "tmux not found. Run `brew install tmux`." };
  }

  // Resolve the agent binary to an absolute path now, while we still inherit
  // the caller's PATH. Lazy mode runs the launch script via osascript→iTerm,
  // which executes `/bin/sh` with a minimal environment that may not include
  // ~/.zshrc additions like /opt/homebrew/bin or version-manager shims.
  const agentBinary = whichSync(opts.agent.command);
  if (!agentBinary) {
    return {
      ok: false,
      error: `${opts.agent.command} not found in PATH. Install it or adjust PATH before running popagent.`,
    };
  }

  const agentArgv = [agentBinary, ...opts.agent.buildArgs(opts.prompt)];
  const agentCmd = agentArgv.map(shellQuote).join(" ");
  const userShell = process.env.SHELL || "/bin/zsh";
  // Keep the tmux session alive after the agent exits by execing into a login shell.
  const wrappedCmd = `${agentCmd}; exec ${shellQuote(userShell)} -l`;

  if (opts.lazy) {
    if (opts.autoAttach !== false) {
      return {
        ok: false,
        error: "lazy mode requires attach=notify (cannot combine with auto-attach)",
      };
    }
    return launchLazy({ ...opts, tmuxPath, wrappedCmd });
  }

  opts.log("INFO", `tmux new-session: name=${opts.sessionName} cwd=${opts.cwd} cmd=${wrappedCmd}`);
  const tmuxRes = runSync([
    tmuxPath,
    "new-session",
    "-d",
    "-s",
    opts.sessionName,
    "-c",
    opts.cwd,
    wrappedCmd,
  ]);
  if (tmuxRes.exitCode !== 0) {
    return {
      ok: false,
      error: `tmux launch failed (exit ${tmuxRes.exitCode}): ${tmuxRes.stderr.trim()}`,
    };
  }

  // Destroy the session as soon as the last client detaches. Agents that
  // support resume (claude --resume, codex resume) can pick the conversation
  // back up, so leaving an orphan session running is more wasteful than
  // user-friendly.
  const hookRes = runSync([
    tmuxPath,
    "set-hook",
    "-t",
    opts.sessionName,
    "client-detached",
    "kill-session",
  ]);
  if (hookRes.exitCode !== 0) {
    opts.log("WARN", `tmux set-hook client-detached failed: ${hookRes.stderr.trim()}`);
  }

  if (opts.autoAttach !== false) {
    attachIterm(opts.sessionName, opts.log);
  } else {
    const notified = terminalNotifier(opts.sessionName, opts.log, {
      agentName: opts.agent.displayName,
      lazy: false,
      context: opts.notificationContext,
      prLabel: opts.notificationPrLabel,
    });
    if (!notified) {
      opts.log(
        "WARN",
        `notification helper failed; run \`tmux attach -t ${opts.sessionName}\` manually`,
      );
    }
  }

  // Wait for the agent UI to render, then send `/rename`.
  if (opts.title) {
    await sendRenameToSession(tmuxPath, opts.sessionName, opts.title, opts.log);
  }

  return { ok: true, session: opts.sessionName, cwd: opts.cwd };
}

interface LazyContext extends PopOptions {
  tmuxPath: string;
  wrappedCmd: string;
}

function launchLazy(ctx: LazyContext): PopResult {
  const scriptPath = writeLazyLaunchScript(ctx);
  ctx.log("INFO", `lazy mode: launch script written to ${scriptPath}`);

  const notified = terminalNotifier(ctx.sessionName, ctx.log, {
    launchScriptPath: scriptPath,
    agentName: ctx.agent.displayName,
    lazy: true,
    context: ctx.notificationContext,
    prLabel: ctx.notificationPrLabel,
  });
  if (!notified) {
    return {
      ok: false,
      error: `notification helper failed; lazy mode requires it. script left at ${scriptPath}`,
    };
  }
  return { ok: true, session: ctx.sessionName, cwd: ctx.cwd };
}

function writeLazyLaunchScript(ctx: LazyContext): string {
  const dir = mkdtempSync(join(tmpdir(), "popagent-"));
  const scriptPath = join(dir, "launch.sh");

  const tmux = shellQuote(ctx.tmuxPath);
  const session = shellQuote(ctx.sessionName);
  const cwd = shellQuote(ctx.cwd);
  const wrapped = shellQuote(ctx.wrappedCmd);

  // Indented so the optional rename only runs on first launch (inside the `if`).
  const renameBlock = ctx.title
    ? `\t( sleep 2; ${ctx.tmuxPath} send-keys -t ${session} ${shellQuote(`/rename ${ctx.title}`)} Enter ) &\n`
    : "";

  // This script must be safe to run more than once. macOS can route a single
  // notification click to multiple notifier instances (they share one bundle
  // id), and a rapid double-click can replay this script. The `has-session`
  // guard makes a re-run attach to the existing session instead of failing on a
  // duplicate `new-session` — without it, `set -e` aborts before `exec` and
  // iTerm reports "A session ended very soon after starting". For the same
  // reason we do NOT delete the script here: a re-run needs the file to still
  // exist. The temp dir lives under $TMPDIR and is reaped by macOS.
  const script = `#!/bin/sh
set -e
if ! ${tmux} has-session -t ${session} 2>/dev/null; then
\t${tmux} new-session -d -s ${session} -c ${cwd} ${wrapped}
\t${tmux} set-hook -t ${session} client-detached kill-session
${renameBlock}fi
exec ${tmux} attach -t ${session}
`;
  writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
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
