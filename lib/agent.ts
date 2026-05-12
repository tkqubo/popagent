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
  /** Build argv for spawning the agent with the given initial prompt. */
  buildArgs(prompt: string): string[];
}

export const AGENTS: Record<AgentKind, AgentSpec> = {
  claude: { command: "claude", buildArgs: (p) => [p] },
  codex:  { command: "codex",  buildArgs: (p) => [p] },
  cursor: { command: "agent",  buildArgs: (p) => [p] },
};

export const AGENT_KINDS = Object.keys(AGENTS) as AgentKind[];

export function isAgentKind(value: string): value is AgentKind {
  return value in AGENTS;
}
