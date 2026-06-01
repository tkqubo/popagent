/**
 * Watch a GitHub PR for new comments and pop an agent to address them.
 *
 * This module exports `watchCommand` consumed by `popagent.ts`.
 */
import { defineCommand } from "citty";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTS, AGENT_KINDS, isAgentKind } from "./lib/agent.ts";
import { findUnknownLongFlags } from "./lib/cli.ts";
import { loadConfig } from "./lib/config.ts";
import { FILTER_MODES, isFilterMode } from "./lib/filter.ts";
import { makeLogger } from "./lib/log.ts";
import { watchPr } from "./lib/watch.ts";

const log = makeLogger("watch-pr");

const DEFAULT_AGENT = loadConfig().defaultAgent ?? "claude";

const DURATION_UNITS_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** "4298" or "4298,4300,4310" → unique positive ints. Returns null if any token is invalid. */
function parsePrList(input: string): number[] | null {
  const tokens = input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const t of tokens) {
    if (!/^[0-9]+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** "30m" / "1.5h" / "2d" → ms. Returns null on invalid input or non-positive value. */
function parseDuration(input: string): number | null {
  const m = /^([0-9]+(?:\.[0-9]+)?)([smhd])$/.exec(input.trim());
  if (!m) return null;
  const value = Number.parseFloat(m[1]!);
  const unit = DURATION_UNITS_MS[m[2]!];
  if (!Number.isFinite(value) || value <= 0 || unit === undefined) return null;
  return value * unit;
}

const watchArgs = {
  pr: {
    type: "string",
    required: true,
    description: "PR number(s) to watch. Comma-separated for multiple PRs in the same repo (e.g. 4298,4300,4310).",
  },
  interval: {
    type: "string",
    default: "5",
    description: "Polling interval in minutes (default: 5)",
  },
  agent: {
    type: "string",
    alias: "a",
    default: DEFAULT_AGENT,
    description: `AI agent CLI to spawn (${AGENT_KINDS.join(" | ")}). Overrides defaultAgent from config.`,
  },
  cwd: {
    type: "string",
    alias: "C",
    description: "Repository working directory (default: current cwd)",
  },
  lazy: {
    type: "boolean",
    default: false,
    description: "Notify only; defer agent startup until you click the notification",
  },
  "include-self": {
    type: "boolean",
    default: false,
    description: "Also react to your own comments (default: excluded to avoid feedback loops)",
  },
  since: {
    type: "string",
    description:
      "Shift the baseline back so items from this far in the past are picked up on the first poll. " +
      "Format: <number><unit> where unit is s|m|h|d (e.g. 30m, 1h, 2d). Default: 0 (only react to items posted after watch starts).",
  },
  filter: {
    type: "string",
    default: "non-issue",
    description:
      "AI-driven comment filter applied before popping. " +
      `Values: ${FILTER_MODES.join(" | ")}. ` +
      "'non-issue' (default) uses the agent's headless mode to drop LGTM/ack-style comments. " +
      "'off' disables filtering. " +
      "Agents without a headless mode (e.g. cursor) silently fall back to 'off'.",
  },
} as const;

export const watchCommand = defineCommand({
  meta: {
    name: "watch",
    description: "Poll a GitHub PR for new comments and pop an agent to address them",
  },
  args: watchArgs,
  async run({ args, rawArgs }) {
    const unknown = findUnknownLongFlags(rawArgs, watchArgs);
    if (unknown.length > 0) {
      log("ERROR", `unknown flag(s): ${unknown.join(", ")}. Try \`popagent watch --help\`.`);
      process.exit(2);
    }

    const cwd = resolve(args.cwd ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      log("ERROR", `cwd is not a directory: ${cwd}`);
      process.exit(2);
    }

    const prs = parsePrList(args.pr);
    if (prs === null) {
      log("ERROR", `--pr must be one or more positive integers (comma-separated): ${args.pr}`);
      process.exit(2);
    }

    const intervalMin = Number.parseFloat(args.interval);
    if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
      log("ERROR", `--interval must be a positive number of minutes: ${args.interval}`);
      process.exit(2);
    }

    if (!isAgentKind(args.agent)) {
      log("ERROR", `unknown --agent: ${args.agent}. expected one of: ${AGENT_KINDS.join(", ")}`);
      process.exit(2);
    }

    if (!isFilterMode(args.filter)) {
      log("ERROR", `unknown --filter: ${args.filter}. expected one of: ${FILTER_MODES.join(", ")}`);
      process.exit(2);
    }

    let lookbackMs: number | undefined;
    if (args.since !== undefined) {
      const parsed = parseDuration(args.since);
      if (parsed === null) {
        log("ERROR", `--since must look like 30m, 1h, 2d (got: ${args.since})`);
        process.exit(2);
      }
      lookbackMs = parsed;
    }

    const result = await watchPr({
      prs,
      intervalMs: intervalMin * 60_000,
      agent: AGENTS[args.agent],
      cwd,
      lazy: args.lazy,
      includeSelf: args["include-self"],
      lookbackMs,
      filterMode: args.filter,
      log,
    });
    if (!result.ok) {
      log("ERROR", result.error);
      process.exit(1);
    }
  },
});
