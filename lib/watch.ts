/**
 * Poll a GitHub PR for new comments and pop an agent to address them.
 *
 * This module is a "prompt producer": it watches a PR and, on new comments,
 * builds a prompt and hands it to `pop()` (always in notification mode).
 */
import type { AgentSpec } from "./agent.ts";
import {
  type Classification,
  classifyComment,
  type FilterMode,
  filterEnabled,
  shouldPop,
} from "./filter.ts";
import { FilterCache } from "./filter-cache.ts";
import {
  checkPrExists,
  fetchPrComments,
  getRepoSlug,
  getViewerLogin,
  type PrComment,
  resolveGh,
} from "./github.ts";
import type { Logger } from "./log.ts";
import { pop } from "./pop.ts";
import { sleep } from "./process.ts";

export interface WatchOptions {
  /** PR numbers to watch (all resolved against the same repo at `cwd`) */
  prs: number[];
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Agent to spawn when new comments arrive */
  agent: AgentSpec;
  /** Repository working directory (absolute path) */
  cwd: string;
  /** Notify only and defer agent startup until the notification is clicked */
  lazy: boolean;
  /** React to the authenticated user's own comments too (default: excluded) */
  includeSelf: boolean;
  /**
   * Offset the "only react to items newer than X" baseline backwards from
   * startup by this many milliseconds. Default 0 = baseline is exactly when
   * the watcher starts.
   */
  lookbackMs?: number;
  /**
   * AI filter mode. "non-issue" drops LGTM/ack-style comments via the agent's
   * headless mode. "off" disables filtering. If the chosen agent has no
   * headless mode, the filter is silently disabled.
   */
  filterMode: FilterMode;
  log: Logger;
}

/** Only returns on a fatal startup error; otherwise loops until interrupted. */
export type WatchResult = { ok: false; error: string };

export async function watchPr(opts: WatchOptions): Promise<WatchResult> {
  if (opts.prs.length === 0) return { ok: false, error: "no PR numbers given" };

  const ghPath = resolveGh(opts.log);
  if (!ghPath) return { ok: false, error: "gh CLI not found" };

  const slug = getRepoSlug(ghPath, opts.cwd, opts.log);
  if (!slug) return { ok: false, error: `could not resolve a GitHub repo at ${opts.cwd}` };

  // Pre-flight every PR so wrong-cwd / wrong-number invocations fail fast
  // with one clear message, instead of producing a 404 storm on every poll.
  const missing: number[] = [];
  for (const pr of opts.prs) {
    const status = checkPrExists(ghPath, slug, pr, opts.cwd);
    if (status === "not_found") {
      missing.push(pr);
    } else if (typeof status === "object") {
      opts.log(
        "WARN",
        `PR #${pr} pre-flight unclear: ${status.error}; will attempt polling anyway`,
      );
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `PR(s) not found in ${slug}: ${missing.map((n) => `#${n}`).join(", ")}. ` +
        `popagent resolved the repo from ${opts.cwd}. ` +
        `If you meant a different repo, run watch from that checkout or pass \`-C <path>\`.`,
    };
  }

  let viewer: string | null = null;
  if (!opts.includeSelf) {
    viewer = getViewerLogin(ghPath, opts.log);
    if (!viewer) {
      opts.log("WARN", "could not determine the gh user; your own comments will NOT be filtered");
    }
  }

  // Baseline: by default, only react to items created after the watcher
  // starts. `lookbackMs` shifts the baseline backwards so older items get
  // picked up on the first poll (useful for "catch up on the last hour").
  const baselineMs = Date.now() - (opts.lookbackMs ?? 0);
  // key → updatedAtMs we last processed at. A comment is "fresh" if absent or
  // if its updatedAtMs moved forward (i.e. it was edited).
  const seenByPr = new Map<number, Map<string, number>>(opts.prs.map((pr) => [pr, new Map()]));

  const filterActive = filterEnabled(opts.filterMode, opts.agent);
  if (opts.filterMode === "non-issue" && !filterActive) {
    opts.log(
      "WARN",
      `--filter non-issue requested but ${opts.agent.displayName} has no headless mode; ` +
        `filter disabled — all comments will pop`,
    );
  }

  const filterCache = new FilterCache(FilterCache.defaultPath(), opts.log);
  if (filterActive) {
    filterCache.load();
    opts.log("INFO", `filter cache: ${filterCache.size} entries loaded from ${filterCache.path}`);
  }

  opts.log(
    "INFO",
    `watching ${slug} PR(s) ${opts.prs.map((n) => `#${n}`).join(", ")} every ` +
      `${opts.intervalMs / 60_000}min (baseline=${new Date(baselineMs).toISOString()}, ` +
      `lazy=${opts.lazy}, viewer=${viewer ?? "n/a"}, ` +
      `filter=${filterActive ? opts.filterMode : "off"})`,
  );

  for (;;) {
    for (const pr of opts.prs) {
      try {
        let seen = seenByPr.get(pr);
        if (!seen) {
          seen = new Map<string, number>();
          seenByPr.set(pr, seen);
        }
        const comments = fetchPrComments(ghPath, slug, pr, opts.cwd, opts.log);
        const fresh = comments.filter((c) => {
          if (!Number.isFinite(c.createdAtMs)) return false;
          if (c.createdAtMs <= baselineMs) return false;
          if (!opts.includeSelf && viewer && c.author === viewer) return false;
          const recorded = seen.get(c.key);
          if (recorded !== undefined) {
            // Same key was already processed. Treat as fresh only if the
            // comment has been edited since (updatedAtMs moved forward).
            if (!Number.isFinite(c.updatedAtMs)) return false;
            if (c.updatedAtMs <= recorded) return false;
          }
          return true;
        });
        for (const c of fresh) {
          seen.set(c.key, Number.isFinite(c.updatedAtMs) ? c.updatedAtMs : c.createdAtMs);
        }

        if (fresh.length > 0) {
          opts.log("INFO", `PR #${pr}: detected ${fresh.length} new/edited comment(s)`);
          const toPop = filterActive
            ? await applyFilter(fresh, opts, pr, slug, filterCache)
            : fresh;
          if (toPop.length > 0) {
            await handleNewComments(opts, slug, pr, toPop);
          } else if (filterActive) {
            opts.log(
              "INFO",
              `PR #${pr}: all ${fresh.length} comment(s) classified as non-issue; nothing to pop`,
            );
          }
        } else {
          opts.log("INFO", `PR #${pr}: no new comments`);
        }
      } catch (e) {
        opts.log("WARN", `PR #${pr}: poll failed: ${(e as Error).message}`);
      }
    }
    await sleep(opts.intervalMs);
  }
}

interface FilterItem {
  comment: PrComment;
  cacheKey: string;
  hit: ReturnType<FilterCache["get"]>;
  stale: boolean;
}

async function applyFilter(
  fresh: PrComment[],
  opts: WatchOptions,
  pr: number,
  slug: string,
  cache: FilterCache,
): Promise<PrComment[]> {
  // Build per-comment metadata so we can iterate without parallel arrays /
  // index-based array access.
  const items: FilterItem[] = fresh.map((comment) => {
    const cacheKey = `${slug}:${comment.key}`;
    const hit = cache.get(cacheKey);
    let stale = false;
    if (hit) {
      const hitAtMs = Date.parse(hit.at);
      stale =
        Number.isFinite(hitAtMs) &&
        Number.isFinite(comment.updatedAtMs) &&
        comment.updatedAtMs > hitAtMs;
    }
    return { comment, cacheKey, hit, stale };
  });

  const toClassify = items.filter(({ hit, stale }) => !hit || stale);

  const classifications = await Promise.all(
    toClassify.map((item) => classifyComment(item.comment, opts.agent, opts.log)),
  );
  const classificationByItem = new Map<FilterItem, Classification>();
  toClassify.forEach((item, j) => {
    const d = classifications[j];
    if (d !== undefined) classificationByItem.set(item, d);
  });

  const agentName = opts.agent.command;
  for (const item of toClassify) {
    const d = classificationByItem.get(item);
    if (d !== undefined && d !== "uncertain") {
      cache.set(item.cacheKey, d, agentName);
    }
  }
  if (toClassify.length > 0) cache.flush();

  const cacheHits = items.filter(({ hit, stale }) => hit && !stale).length;
  const staleHits = items.filter(({ stale }) => stale).length;
  if (cacheHits > 0 || staleHits > 0 || toClassify.length > 0) {
    opts.log(
      "INFO",
      `PR #${pr}: filter (cache hits=${cacheHits}, stale=${staleHits}, AI calls=${toClassify.length})`,
    );
  }

  const survivors: PrComment[] = [];
  for (const item of items) {
    const d = item.hit && !item.stale ? item.hit.classification : classificationByItem.get(item);
    // Defensive fallback: if we somehow lack a verdict, lean toward popping so
    // the comment isn't silently dropped.
    const verdict: Classification = d ?? "uncertain";
    if (shouldPop(verdict, opts.filterMode)) {
      survivors.push(item.comment);
    } else {
      const snippet = item.comment.body.replace(/\s+/g, " ").slice(0, 80);
      opts.log(
        "INFO",
        `PR #${pr}: filtered out @${item.comment.author} (${verdict}): "${snippet}${
          item.comment.body.length > 80 ? "…" : ""
        }"`,
      );
    }
  }
  if (survivors.length > 0) {
    opts.log("INFO", `PR #${pr}: ${survivors.length}/${fresh.length} comment(s) survived filter`);
  }
  return survivors;
}

async function handleNewComments(
  opts: WatchOptions,
  slug: string,
  pr: number,
  comments: PrComment[],
): Promise<void> {
  const prompt = buildPrompt(slug, pr, comments);
  const session = `ai-watch-${pr}-${Math.floor(Date.now() / 1000)}`;

  const res = await pop({
    prompt,
    agent: opts.agent,
    cwd: opts.cwd,
    sessionName: session,
    title: `PR #${pr} review`,
    autoAttach: false, // watch is notification-driven
    lazy: opts.lazy,
    notificationContext: buildNotificationContext(pr, comments),
    log: opts.log,
  });

  if (!res.ok) {
    opts.log("WARN", `PR #${pr}: pop failed: ${res.error}`);
  } else {
    opts.log("INFO", `PR #${pr}: popped session=${res.session} for ${comments.length} comment(s)`);
  }
}

function buildNotificationContext(pr: number, comments: PrComment[]): string {
  const noun = comments.length === 1 ? "a comment" : `${comments.length} comments`;
  return `Responding to ${noun} on PR #${pr}`;
}

function buildPrompt(slug: string, pr: number, comments: PrComment[]): string {
  const lines: string[] = [
    `New review feedback arrived on ${slug} PR #${pr}. Review the comment(s) below and address them.`,
    "",
  ];
  comments.forEach((c, i) => {
    const header =
      c.kind === "review_summary"
        ? `--- Review submission ${i + 1} by @${c.author}${c.reviewState ? ` (${c.reviewState})` : ""} ---`
        : `--- Comment ${i + 1} (${c.kind}) by @${c.author} ---`;
    lines.push(header);
    if (c.path) lines.push(`Location: ${c.path}${c.line ? `:${c.line}` : ""}`);
    lines.push(c.body.trim());
    lines.push(`URL: ${c.url}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
