/**
 * AI agent CLI registry.
 *
 * All three currently supported agents accept the initial prompt as a single
 * positional argument and expose a `/rename <title>` slash command inside the
 * TUI, so the spec only needs to know which command to invoke.
 */

export type AgentKind = "claude" | "codex" | "cursor";

export interface AgentSpec {
  /** Shell command name (resolved via $PATH). */
  command: string;
  /** Human-readable name used in notifications, etc. */
  displayName: string;
  /** Build argv for spawning the agent with the given initial prompt. */
  buildArgs(prompt: string): string[];
  /**
   * Headless invocation that prints the agent's reply to stdout and exits.
   * Returns the command + argv to run. `undefined` means the agent does not
   * support headless mode (in which case AI-driven filtering is disabled and
   * all comments are popped).
   */
  headlessRun?(prompt: string): { command: string; args: string[] };
}

export const AGENTS: Record<AgentKind, AgentSpec> = {
  claude: {
    command: "claude",
    displayName: "Claude Code",
    buildArgs: (p) => [p],
    headlessRun: (p) => ({ command: "claude", args: ["-p", p] }),
  },
  codex: {
    command: "codex",
    displayName: "Codex",
    buildArgs: (p) => [p],
    headlessRun: (p) => ({ command: "codex", args: ["exec", p] }),
  },
  cursor: {
    command: "agent",
    displayName: "Cursor Agent",
    buildArgs: (p) => [p],
    // No reliable headless mode — filter falls back to "pop everything".
  },
};

export const AGENT_KINDS = Object.keys(AGENTS) as AgentKind[];

export function isAgentKind(value: string): value is AgentKind {
  return value in AGENTS;
}
