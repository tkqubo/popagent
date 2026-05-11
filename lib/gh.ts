/**
 * `gh` CLI wrapper. All GitHub API calls go through here.
 */
import { runSync } from "./process.ts";
import { whichSync } from "./shell.ts";

export class GhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhError";
  }
}

export interface GhApiOptions {
  paginate?: boolean;
  timeoutMs?: number;
}

export function ghApi(path: string, opts: GhApiOptions = {}): unknown {
  const cmd = ["gh", "api"];
  if (opts.paginate) cmd.push("--paginate");
  cmd.push(path);

  const r = runSync(cmd, { timeoutMs: opts.timeoutMs ?? 15000 });
  if (r.error) {
    throw new GhError(`gh api spawn error: ${r.error.message}`);
  }
  if (r.exitCode !== 0) {
    throw new GhError(
      `gh api failed (exit ${r.exitCode}) path=${path}\nstderr: ${r.stderr.trim()}`,
    );
  }
  const stdout = r.stdout.trim();
  if (!stdout) return opts.paginate ? [] : {};
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new GhError(`gh api returned non-JSON: ${(e as Error).message}`);
  }
}

/**
 * Verify that `gh` exists and is authenticated.
 */
export function assertGhReady(): void {
  if (!whichSync("gh")) {
    throw new GhError("gh not found. Run `brew install gh`.");
  }
  const r = runSync(["gh", "auth", "status"], { timeoutMs: 5000 });
  if (r.exitCode !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim();
    throw new GhError(`gh is not authenticated. Run \`gh auth login\`.\n${msg}`);
  }
}

/**
 * Return the login of the authenticated user.
 */
export function getGithubUsername(): string {
  const data = ghApi("/user") as { login?: string };
  if (!data?.login) {
    throw new GhError("gh api /user returned no login");
  }
  return data.login;
}

/**
 * Head branch ref and author login of a PR.
 */
export interface PrSummary {
  head_ref: string;
  author: string;
}

export function fetchPrSummary(repo: string, prNumber: number): PrSummary {
  const data = ghApi(`/repos/${repo}/pulls/${prNumber}`) as {
    head?: { ref?: string };
    user?: { login?: string };
  };
  const head_ref = data?.head?.ref;
  const author = data?.user?.login;
  if (!head_ref) {
    throw new GhError(`could not fetch head.ref of PR #${prNumber}`);
  }
  if (!author) {
    throw new GhError(`could not fetch user.login of PR #${prNumber}`);
  }
  return { head_ref, author };
}

/**
 * Convenience: only the PR head branch name.
 */
export function fetchPrHeadRef(repo: string, prNumber: number): string {
  return fetchPrSummary(repo, prNumber).head_ref;
}
