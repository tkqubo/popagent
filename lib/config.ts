/**
 * User-level config loader.
 *
 * Path: $XDG_CONFIG_HOME/popagent/config.json (default ~/.config/popagent/config.json).
 * All fields are optional; an absent file yields an empty config.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_KINDS, type AgentKind, isAgentKind } from "./agent.ts";

export interface Config {
  defaultAgent?: AgentKind;
}

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "popagent", "config.json");
}

export function loadConfig(path: string = defaultConfigPath()): Config {
  if (!existsSync(path)) return {};

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${path}: invalid JSON — ${(e as Error).message}`);
  }

  const out: Config = {};
  if (raw.defaultAgent !== undefined) {
    if (typeof raw.defaultAgent !== "string" || !isAgentKind(raw.defaultAgent)) {
      throw new Error(`${path}: defaultAgent must be one of: ${AGENT_KINDS.join(", ")}`);
    }
    out.defaultAgent = raw.defaultAgent;
  }
  return out;
}
