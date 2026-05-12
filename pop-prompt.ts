/**
 * Pop an AI agent with an arbitrary prompt (tmux + iTerm2).
 *
 * This module exports `popPromptCommand` consumed by `popagent.ts`.
 */
import { defineCommand } from "citty";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTS, AGENT_KINDS, isAgentKind } from "./lib/agent.ts";
import { makeLogger } from "./lib/log.ts";
import { pop } from "./lib/pop.ts";

const log = makeLogger("pop-prompt");

const DEFAULT_AGENT = "claude";

export const popPromptCommand = defineCommand({
  meta: {
    name: "prompt",
    description: "Pop an agent with an arbitrary prompt",
  },
  args: {
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
      description: `AI agent CLI to spawn (${AGENT_KINDS.join(" | ")})`,
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
  },
  async run({ args }) {
    const cwd = resolve(args.cwd ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      log("ERROR", `cwd is not a directory: ${cwd}`);
      process.exit(2);
    }

    if (!isAgentKind(args.agent)) {
      log(
        "ERROR",
        `unknown --agent: ${args.agent}. expected one of: ${AGENT_KINDS.join(", ")}`,
      );
      process.exit(2);
    }
    const agentSpec = AGENTS[args.agent];

    const session =
      args["session-name"] ?? `ai-pop-${args.agent}-${Math.floor(Date.now() / 1000)}`;
    const result = await pop({
      prompt: args.prompt,
      agent: agentSpec,
      cwd,
      sessionName: session,
      title: args.title,
      log,
    });
    if (!result.ok) {
      log("ERROR", result.error);
      process.exit(1);
    }
    log("INFO", `launched: session=${result.session} cwd=${result.cwd}`);
  },
});
