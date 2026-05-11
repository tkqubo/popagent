/**
 * config.json loader (pop-pr-polling).
 *
 * Expected shape:
 *   {
 *     "pr-polling": {
 *       "workspaces": [...],
 *       "ai_agent_command": "...",
 *       "repos": [...],
 *       ...
 *     }
 *   }
 *
 * Top-level `github_username` is also accepted because it can be shared across
 * future subcommands.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getGithubUsername } from "./gh.ts";
import type { Logger } from "./log.ts";
import type { Workspace } from "./workdir.ts";

interface WorkspaceRaw {
  path: string;
  recursive?: boolean;
}

interface PrPollingRaw {
  workspaces?: (string | WorkspaceRaw)[];
  ai_agent_command?: string;
  repos?: string[];
  poll_interval_sec?: number;
  state_path?: string;
  auto_attach?: boolean;
}

interface ConfigRaw {
  github_username?: string;
  "pr-polling"?: PrPollingRaw;
}

export interface Config {
  workspaces: Workspace[];
  ai_agent_command: string;
  github_username: string;
  repos: string[];
  poll_interval_sec: number;
  state_path: string;
  auto_attach: boolean;
  dry_run: boolean;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace(/^~/, process.env.HOME ?? "");
  }
  return p;
}

function parseWorkspace(entry: string | WorkspaceRaw): Workspace {
  if (typeof entry === "string") {
    return { path: expandHome(entry), recursive: false };
  }
  if (entry && typeof entry.path === "string") {
    return { path: expandHome(entry.path), recursive: Boolean(entry.recursive) };
  }
  throw new Error(`Invalid workspace entry: ${JSON.stringify(entry)}`);
}

export function loadConfig(configPath: string, log: Logger): Config {
  if (!existsSync(configPath)) {
    throw new Error(`config not found: ${resolve(configPath)}`);
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as ConfigRaw;

  const section = raw["pr-polling"];
  if (!section) {
    throw new Error(
      `config.pr-polling section is required.\n` +
        `expected shape: { "pr-polling": { "workspaces": [...], "repos": [...], ... } }`,
    );
  }

  const workspacesRaw = section.workspaces ?? [];
  if (workspacesRaw.length === 0) {
    throw new Error("pr-polling.workspaces is empty");
  }
  const workspaces = workspacesRaw.map(parseWorkspace);

  const command = section.ai_agent_command;
  if (!command) throw new Error("pr-polling.ai_agent_command is required");
  if (!command.includes("{comment}")) {
    throw new Error("pr-polling.ai_agent_command must contain {comment} placeholder");
  }

  const repos = section.repos ?? [];
  if (!Array.isArray(repos) || repos.some((r) => typeof r !== "string")) {
    throw new Error("pr-polling.repos must be an array of strings");
  }
  if (repos.length === 0) {
    throw new Error("pr-polling.repos must contain at least one owner/name");
  }

  let username = raw.github_username;
  if (!username) {
    username = getGithubUsername();
    log("INFO", `github_username resolved via gh api /user: ${username}`);
  }

  return {
    workspaces,
    ai_agent_command: command,
    github_username: username,
    repos,
    poll_interval_sec: section.poll_interval_sec ?? 30,
    state_path: expandHome(section.state_path ?? ".state/last_seen.json"),
    auto_attach: Boolean(section.auto_attach),
    dry_run: false,
  };
}
