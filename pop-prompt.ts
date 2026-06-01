/**
 * Pop an AI agent with an arbitrary prompt (tmux + iTerm2).
 *
 * This module exports `popPromptCommand` consumed by `popagent.ts`.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { AGENT_KINDS, AGENTS, isAgentKind } from "./lib/agent.ts";
import { findUnknownLongFlags } from "./lib/cli.ts";
import { loadConfig } from "./lib/config.ts";
import { makeLogger } from "./lib/log.ts";
import { pop } from "./lib/pop.ts";

const log = makeLogger("pop-prompt");

const DEFAULT_AGENT = loadConfig().defaultAgent ?? "claude";
const ATTACH_MODES = ["iterm", "notify"] as const;
type AttachMode = (typeof ATTACH_MODES)[number];

function isAttachMode(v: string): v is AttachMode {
  return (ATTACH_MODES as readonly string[]).includes(v);
}

function buildPromptContext(prompt: string): string {
  const flat = prompt.trim().replace(/\s+/g, " ");
  const truncated = flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}…` : flat;
  return `Prompt: "${truncated}"`;
}

export const popPromptArgs = {
  prompt: {
    type: "string",
    required: true,
    alias: "p",
    description: "Initial prompt passed to the agent",
  },
  agent: {
    type: "string",
    alias: "a",
    default: DEFAULT_AGENT,
    description: `AI agent CLI to spawn (${AGENT_KINDS.join(" | ")}). Overrides defaultAgent from ~/.config/popagent/config.json.`,
  },
  cwd: {
    type: "string",
    alias: "C",
    description: "Working directory (default: current cwd)",
  },
  "session-name": {
    type: "string",
    alias: "s",
    description: "tmux session name (default: ai-pop-<agent>-<epoch>)",
  },
  title: {
    type: "string",
    alias: "t",
    description: "Agent session title — sent via `/rename <title>` after launch",
  },
  attach: {
    type: "string",
    default: "iterm",
    description: `How to present the session after launch (${ATTACH_MODES.join(" | ")}).`,
  },
  lazy: {
    type: "boolean",
    default: false,
    description:
      "Defer tmux + agent startup until the user clicks the notification. Requires --attach notify.",
  },
} as const;

export const popPromptCommand = defineCommand({
  meta: {
    name: "prompt",
    description: "Pop an agent with an arbitrary prompt",
  },
  args: popPromptArgs,
  async run({ args, rawArgs }) {
    const unknown = findUnknownLongFlags(rawArgs, popPromptArgs);
    if (unknown.length > 0) {
      log("ERROR", `unknown flag(s): ${unknown.join(", ")}. Try \`popagent prompt --help\`.`);
      process.exit(2);
    }

    const cwd = resolve(args.cwd ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      log("ERROR", `cwd is not a directory: ${cwd}`);
      process.exit(2);
    }

    if (!isAgentKind(args.agent)) {
      log("ERROR", `unknown --agent: ${args.agent}. expected one of: ${AGENT_KINDS.join(", ")}`);
      process.exit(2);
    }
    const agentSpec = AGENTS[args.agent];

    if (!isAttachMode(args.attach)) {
      log("ERROR", `unknown --attach: ${args.attach}. expected one of: ${ATTACH_MODES.join(", ")}`);
      process.exit(2);
    }

    if (args.lazy && args.attach !== "notify") {
      log("ERROR", "--lazy requires --attach notify (cannot combine with iTerm auto-attach)");
      process.exit(2);
    }

    const session = args["session-name"] ?? `ai-pop-${args.agent}-${Math.floor(Date.now() / 1000)}`;
    const result = await pop({
      prompt: args.prompt,
      agent: agentSpec,
      cwd,
      sessionName: session,
      title: args.title,
      autoAttach: args.attach !== "notify",
      lazy: args.lazy,
      notificationContext: buildPromptContext(args.prompt),
      log,
    });
    if (!result.ok) {
      log("ERROR", result.error);
      process.exit(1);
    }
    log("INFO", `launched: session=${result.session} cwd=${result.cwd}`);
  },
});
