/**
 * Search workspaces for a local git directory whose current branch matches.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runSync } from "./process.ts";

export interface Workspace {
  path: string;
  recursive: boolean;
}

export function* iterWorkspaceDirs(workspaces: Workspace[]): Generator<string> {
  for (const ws of workspaces) {
    if (!existsSync(ws.path)) continue;
    try {
      if (!statSync(ws.path).isDirectory()) continue;
    } catch {
      continue;
    }
    yield ws.path;
    if (ws.recursive) {
      let entries;
      try {
        entries = readdirSync(ws.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.isSymbolicLink()) {
          yield resolve(ws.path, e.name);
        }
      }
    }
  }
}

export function isGitDir(p: string): boolean {
  return existsSync(resolve(p, ".git"));
}

export function currentBranch(p: string): string | null {
  const r = runSync(["git", "-C", p, "rev-parse", "--abbrev-ref", "HEAD"], {
    timeoutMs: 5000,
  });
  if (r.exitCode !== 0) return null;
  const branch = r.stdout.trim();
  if (!branch || branch === "HEAD") return null;
  return branch;
}

export function findWorkdirForBranch(
  workspaces: Workspace[],
  branch: string,
): string | null {
  for (const d of iterWorkspaceDirs(workspaces)) {
    if (!isGitDir(d)) continue;
    if (currentBranch(d) === branch) return d;
  }
  return null;
}
