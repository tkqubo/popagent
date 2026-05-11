/**
 * Polls GitHub for new comments by other people on your PRs and pops an agent.
 *
 * Exports `popPrPollingCommand`, consumed by `popagent.ts`.
 *
 * Uses `gh` CLI for authentication. Detects new comments on your own PRs
 * (authored by someone else), finds the local workdir whose current branch
 * matches the PR head, and pops an AI agent in tmux + iTerm2.
 */
import { defineCommand } from "citty";
import { existsSync, unlinkSync } from "node:fs";
import type { Config } from "./lib/config.ts";
import { loadConfig } from "./lib/config.ts";
import {
  assertGhReady,
  fetchPrSummary,
  ghApi,
  GhError,
  type PrSummary,
} from "./lib/gh.ts";
import { makeLogger } from "./lib/log.ts";
import { pop } from "./lib/pop.ts";
import { sleep } from "./lib/process.ts";
import {
  loadState,
  newRepoState,
  saveState,
  utcNowIso,
  type State,
} from "./lib/state.ts";
import { findWorkdirForBranch } from "./lib/workdir.ts";

const log = makeLogger("pop-pr-polling");
const CONFIG_PATH = process.env.CONFIG_PATH ?? "config.json";

// ============================================================
// Types
// ============================================================

interface PRCommentInfo {
  pr_number: number;
  head_ref: string;
  comment_body: string;
  comment_author: string;
  pr_author: string;
  repo_full_name: string;
}

interface IssueComment {
  id: number;
  body?: string;
  user?: { login?: string };
  issue_url?: string;
}

interface IssueData {
  number: number;
  pull_request?: unknown;
}

interface PRReviewComment {
  id: number;
  body?: string;
  user?: { login?: string };
  pull_request_url?: string;
}

type TriggerResult =
  | { started: true; session: string; workdir: string; pr_number: number; branch: string }
  | { dry_run: true; session: string; workdir: string; pr_number: number; branch: string }
  | { skipped: "self_comment" }
  | { skipped: "not_my_pr"; pr_author: string }
  | { skipped: "no_workdir"; branch: string }
  | { error: string };

// ============================================================
// Trigger
// ============================================================

async function triggerForComment(cfg: Config, info: PRCommentInfo): Promise<TriggerResult> {
  // 自分が書いたコメントは無視
  if (info.comment_author === cfg.github_username) {
    return { skipped: "self_comment" };
  }
  // 自分の PR でなければ無視
  if (info.pr_author !== cfg.github_username) {
    return { skipped: "not_my_pr", pr_author: info.pr_author };
  }
  const workdir = findWorkdirForBranch(cfg.workspaces, info.head_ref);
  if (workdir === null) {
    log("INFO", `no workdir found for branch ${info.head_ref}`);
    return { skipped: "no_workdir", branch: info.head_ref };
  }

  const session = `ai-pop-pr-polling-${info.pr_number}-${Math.floor(Date.now() / 1000)}`;

  if (cfg.dry_run) {
    log("INFO", `[dry-run] would launch: session=${session} workdir=${workdir}`);
    return {
      dry_run: true,
      session,
      workdir,
      pr_number: info.pr_number,
      branch: info.head_ref,
    };
  }

  const result = await pop({
    prompt: info.comment_body,
    cwd: workdir,
    sessionName: session,
    title: `pr-${info.pr_number}`,
    autoAttach: cfg.auto_attach,
    prNumber: info.pr_number,
    agentCommandTemplate: cfg.ai_agent_command,
    log,
  });
  if (!result.ok) {
    log("ERROR", `pop failed: ${result.error}`);
    return { error: "pop_failed" };
  }
  return {
    started: true,
    session: result.session,
    workdir: result.cwd,
    pr_number: info.pr_number,
    branch: info.head_ref,
  };
}

// ============================================================
// Polling
// ============================================================

async function pollIssueComments(cfg: Config, state: State, repo: string): Promise<void> {
  let s = state[repo];
  if (!s) {
    s = newRepoState();
    state[repo] = s;
  }
  if (!s.issue_comments_since) s.issue_comments_since = utcNowIso();
  const newSince = utcNowIso();

  const path =
    `/repos/${repo}/issues/comments` +
    `?since=${encodeURIComponent(s.issue_comments_since)}&sort=created&direction=asc&per_page=100`;
  const comments = ghApi(path, { paginate: true }) as IssueComment[];
  if (!Array.isArray(comments)) return;

  for (const c of comments) {
    const cid = Number(c.id ?? 0);
    if (cid <= s.issue_comments_max_id) continue;
    const author = c.user?.login ?? "";
    // 自分のコメントは即スキップ
    if (author === cfg.github_username) {
      s.issue_comments_max_id = Math.max(s.issue_comments_max_id, cid);
      continue;
    }

    const issueUrlPath = (c.issue_url ?? "").replace("https://api.github.com", "");
    if (!issueUrlPath) continue;
    let issueData: IssueData;
    try {
      issueData = ghApi(issueUrlPath) as IssueData;
    } catch (e) {
      log("WARN", `failed to fetch issue: ${(e as Error).message}`);
      continue;
    }
    // PR でなければスキップ
    if (!issueData || !("pull_request" in issueData)) {
      s.issue_comments_max_id = Math.max(s.issue_comments_max_id, cid);
      continue;
    }

    const prNumber = Number(issueData.number);
    let pr: PrSummary;
    try {
      pr = fetchPrSummary(repo, prNumber);
    } catch (e) {
      log("WARN", `failed to fetch PR #${prNumber}: ${(e as Error).message}`);
      s.issue_comments_max_id = Math.max(s.issue_comments_max_id, cid);
      continue;
    }

    const info: PRCommentInfo = {
      pr_number: prNumber,
      head_ref: pr.head_ref,
      comment_body: c.body ?? "",
      comment_author: author,
      pr_author: pr.author,
      repo_full_name: repo,
    };
    const result = await triggerForComment(cfg, info);
    log("INFO", `[poll/issue_comments] ${repo} pr#${prNumber} id=${cid} -> ${JSON.stringify(result)}`);
    s.issue_comments_max_id = Math.max(s.issue_comments_max_id, cid);
  }

  s.issue_comments_since = newSince;
}

async function pollPrReviewComments(cfg: Config, state: State, repo: string): Promise<void> {
  let s = state[repo];
  if (!s) {
    s = newRepoState();
    state[repo] = s;
  }
  if (!s.pr_review_comments_since) s.pr_review_comments_since = utcNowIso();
  const newSince = utcNowIso();

  const path =
    `/repos/${repo}/pulls/comments` +
    `?since=${encodeURIComponent(s.pr_review_comments_since)}&sort=created_at&direction=asc&per_page=100`;
  const comments = ghApi(path, { paginate: true }) as PRReviewComment[];
  if (!Array.isArray(comments)) return;

  for (const c of comments) {
    const cid = Number(c.id ?? 0);
    if (cid <= s.pr_review_comments_max_id) continue;
    const author = c.user?.login ?? "";
    if (author === cfg.github_username) {
      s.pr_review_comments_max_id = Math.max(s.pr_review_comments_max_id, cid);
      continue;
    }

    const prUrl = c.pull_request_url ?? "";
    const match = prUrl.match(/\/(\d+)$/);
    if (!match) continue;
    const prNumber = Number(match[1]);
    let pr: PrSummary;
    try {
      pr = fetchPrSummary(repo, prNumber);
    } catch (e) {
      log("WARN", `failed to fetch PR #${prNumber}: ${(e as Error).message}`);
      s.pr_review_comments_max_id = Math.max(s.pr_review_comments_max_id, cid);
      continue;
    }

    const info: PRCommentInfo = {
      pr_number: prNumber,
      head_ref: pr.head_ref,
      comment_body: c.body ?? "",
      comment_author: author,
      pr_author: pr.author,
      repo_full_name: repo,
    };
    const result = await triggerForComment(cfg, info);
    log("INFO", `[poll/pr_review_comments] ${repo} pr#${prNumber} id=${cid} -> ${JSON.stringify(result)}`);
    s.pr_review_comments_max_id = Math.max(s.pr_review_comments_max_id, cid);
  }

  s.pr_review_comments_since = newSince;
}

async function pollOnce(cfg: Config, state: State): Promise<void> {
  for (const repo of cfg.repos) {
    try {
      await pollIssueComments(cfg, state, repo);
      await pollPrReviewComments(cfg, state, repo);
    } catch (e) {
      log("WARN", `[poll] ${repo} error: ${(e as Error).message}`);
    }
  }
}

async function pollLoop(cfg: Config, opts: { once?: boolean } = {}): Promise<void> {
  const state = loadState(cfg.state_path, log);
  const now = utcNowIso();
  for (const repo of cfg.repos) {
    if (!(repo in state)) {
      state[repo] = {
        issue_comments_max_id: 0,
        pr_review_comments_max_id: 0,
        issue_comments_since: now,
        pr_review_comments_since: now,
      };
    }
  }
  saveState(cfg.state_path, state);

  if (opts.once) {
    log("INFO", `[once] running 1 tick: repos=${JSON.stringify(cfg.repos)} state=${cfg.state_path}`);
    await pollOnce(cfg, state);
    saveState(cfg.state_path, state);
    return;
  }

  log(
    "INFO",
    `polling started: repos=${JSON.stringify(cfg.repos)} interval=${cfg.poll_interval_sec}s state=${cfg.state_path} dry_run=${cfg.dry_run}`,
  );
  while (true) {
    try {
      await pollOnce(cfg, state);
      saveState(cfg.state_path, state);
    } catch (e) {
      log("ERROR", `unexpected polling error: ${(e as Error).stack ?? (e as Error).message}`);
    }
    await sleep(cfg.poll_interval_sec * 1000);
  }
}

// ============================================================
// CLI (citty)
// ============================================================

export const popPrPollingCommand = defineCommand({
  meta: {
    name: "pr-polling",
    description:
      "Long-running daemon: poll GitHub for new comments by others on your PRs",
  },
  args: {
    once: {
      type: "boolean",
      description: "Run one polling tick and exit (state file is still updated)",
    },
    "dry-run": {
      type: "boolean",
      description:
        "Detect comments and log what would happen, but skip tmux + notifications",
    },
    "reset-state": {
      type: "boolean",
      description: "Delete .state/last_seen.json before starting (last-seen resets to now)",
    },
  },
  async run({ args }) {
    try {
      assertGhReady();
      const cfg = loadConfig(CONFIG_PATH, log);
      cfg.dry_run = Boolean(args["dry-run"]);

      if (args["reset-state"] && existsSync(cfg.state_path)) {
        unlinkSync(cfg.state_path);
        log("INFO", `state file removed: ${cfg.state_path}`);
      }

      log(
        "INFO",
        `startup: github_username=${cfg.github_username} workspaces=${cfg.workspaces.length} repos=${cfg.repos.length} interval=${cfg.poll_interval_sec}s dry_run=${cfg.dry_run}`,
      );
      await pollLoop(cfg, { once: Boolean(args.once) });
    } catch (e) {
      if (e instanceof GhError) {
        log("ERROR", `startup failed: ${e.message}`);
      } else {
        log("ERROR", `startup failed: ${(e as Error).message}`);
      }
      process.exit(1);
    }
  },
});

