/**
 * GitHub access via the `gh` CLI.
 *
 * Authentication is delegated entirely to `gh` (`gh auth login`); this module
 * only shells out and normalises the JSON.
 */
import type { Logger } from "./log.ts";
import { runSync } from "./process.ts";
import { whichSync } from "./shell.ts";

export type CommentKind = "issue" | "review" | "review_summary";

export interface PrComment {
  /** Stable dedupe key: `${kind}:${id}` (id spaces are distinct across kinds). */
  key: string;
  kind: CommentKind;
  author: string;
  body: string;
  /** ms since epoch; NaN if the API timestamp was unparseable. */
  createdAtMs: number;
  /**
   * Last-modified time in ms (from GitHub's `updated_at`), if available. Falls
   * back to `createdAtMs` when the API didn't return one. Used to invalidate
   * the AI classification cache after a comment edit.
   */
  updatedAtMs: number;
  url: string;
  /** review (line) comments only: file path the comment is anchored to. */
  path?: string;
  /** review (line) comments only: line number the comment is anchored to. */
  line?: number;
  /** review submissions only: APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED. */
  reviewState?: string;
}

interface RawComment {
  id: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  user?: { login?: string } | null;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

interface RawReview {
  id: number;
  body?: string;
  /** Reviews use submitted_at, not created_at. */
  submitted_at?: string;
  /** Some review payloads also carry updated_at when the body has been edited. */
  updated_at?: string;
  html_url?: string;
  user?: { login?: string } | null;
  state?: string;
}

const TIMEOUT_MS = 60_000;

export function resolveGh(log: Logger): string | null {
  const p = whichSync("gh");
  if (!p) {
    log(
      "ERROR",
      "gh CLI not found. Install GitHub CLI (`brew install gh`) and run `gh auth login`.",
    );
  }
  return p;
}

/** The login of the authenticated `gh` user, or null if it can't be resolved. */
export function getViewerLogin(ghPath: string, log: Logger): string | null {
  const r = runSync([ghPath, "api", "user", "--jq", ".login"], { timeoutMs: TIMEOUT_MS });
  if (r.exitCode !== 0) {
    log("WARN", `gh api user failed: ${r.stderr.trim()}`);
    return null;
  }
  return r.stdout.trim() || null;
}

export type PrPreflight = "exists" | "not_found" | { error: string };

/**
 * Check whether a PR exists in the given repo. Used as a startup pre-flight so
 * a wrong-cwd / wrong-number invocation fails fast instead of silently 404'ing
 * every poll.
 */
export function checkPrExists(
  ghPath: string,
  slug: string,
  pr: number,
  cwd: string,
): PrPreflight {
  const r = runSync(
    [ghPath, "api", `repos/${slug}/pulls/${pr}`, "--jq", ".number"],
    { cwd, timeoutMs: TIMEOUT_MS },
  );
  if (r.exitCode === 0) return "exists";
  const stderr = r.stderr.trim();
  if (stderr.includes("HTTP 404") || stderr.includes("Not Found")) return "not_found";
  return { error: stderr.split("\n")[0] || `exit ${r.exitCode}` };
}

/** Resolve the `owner/repo` slug for the repository at `cwd`. */
export function getRepoSlug(ghPath: string, cwd: string, log: Logger): string | null {
  const r = runSync(
    [ghPath, "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd, timeoutMs: TIMEOUT_MS },
  );
  if (r.exitCode !== 0) {
    log("ERROR", `gh repo view failed (is ${cwd} a GitHub repo?): ${r.stderr.trim()}`);
    return null;
  }
  const slug = r.stdout.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) {
    log("ERROR", `unexpected repo slug from gh: ${slug}`);
    return null;
  }
  return slug;
}

function fetchEndpoint<T>(
  ghPath: string,
  slug: string,
  apiPath: string,
  cwd: string,
  log: Logger,
): T[] | null {
  const r = runSync([ghPath, "api", `repos/${slug}/${apiPath}`, "--paginate"], {
    cwd,
    timeoutMs: TIMEOUT_MS,
  });
  if (r.exitCode !== 0) {
    log("WARN", `gh api ${apiPath} failed: ${r.stderr.trim()}`);
    return null;
  }
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch (e) {
    log("WARN", `failed to parse gh api ${apiPath} output: ${(e as Error).message}`);
    return null;
  }
}

function normalizeComments(raw: RawComment[], kind: "issue" | "review"): PrComment[] {
  return raw.map((c) => {
    const createdAtMs = c.created_at ? Date.parse(c.created_at) : Number.NaN;
    const updatedAtMs = c.updated_at ? Date.parse(c.updated_at) : createdAtMs;
    return {
      key: `${kind}:${c.id}`,
      kind,
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAtMs,
      updatedAtMs,
      url: c.html_url ?? "",
      path: c.path,
      line: c.line ?? c.original_line ?? undefined,
    };
  });
}

function normalizeReviews(raw: RawReview[]): PrComment[] {
  return raw
    // Bare approvals / dismissals with no written body are noise — skip them.
    .filter((r) => (r.body ?? "").trim().length > 0)
    .map((r) => {
      const createdAtMs = r.submitted_at ? Date.parse(r.submitted_at) : Number.NaN;
      const updatedAtMs = r.updated_at ? Date.parse(r.updated_at) : createdAtMs;
      return {
        key: `review_summary:${r.id}`,
        kind: "review_summary" as const,
        author: r.user?.login ?? "unknown",
        body: r.body ?? "",
        createdAtMs,
        updatedAtMs,
        url: r.html_url ?? "",
        reviewState: r.state,
      };
    });
}

/**
 * Fetch conversation (issue) comments, code-line (review) comments, and review
 * submissions with a non-empty body. A failed endpoint contributes an empty
 * list rather than aborting the poll.
 */
export function fetchPrComments(
  ghPath: string,
  slug: string,
  pr: number,
  cwd: string,
  log: Logger,
): PrComment[] {
  const issue = fetchEndpoint<RawComment>(ghPath, slug, `issues/${pr}/comments`, cwd, log) ?? [];
  const review = fetchEndpoint<RawComment>(ghPath, slug, `pulls/${pr}/comments`, cwd, log) ?? [];
  const reviews = fetchEndpoint<RawReview>(ghPath, slug, `pulls/${pr}/reviews`, cwd, log) ?? [];
  return [
    ...normalizeComments(issue, "issue"),
    ...normalizeComments(review, "review"),
    ...normalizeReviews(reviews),
  ];
}
