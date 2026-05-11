/**
 * 処理済みコメント ID 永続化ストア（pop-pr-polling.ts 用）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "./log.ts";

export interface RepoState {
  issue_comments_max_id: number;
  pr_review_comments_max_id: number;
  issue_comments_since: string;
  pr_review_comments_since: string;
}

export type State = Record<string, RepoState>;

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function loadState(path: string, log: Logger): State {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<
      string,
      Partial<RepoState>
    >;
    const result: State = {};
    for (const [repo, s] of Object.entries(raw)) {
      result[repo] = {
        issue_comments_max_id: Number(s.issue_comments_max_id ?? 0),
        pr_review_comments_max_id: Number(s.pr_review_comments_max_id ?? 0),
        issue_comments_since: String(s.issue_comments_since ?? ""),
        pr_review_comments_since: String(s.pr_review_comments_since ?? ""),
      };
    }
    return result;
  } catch (e) {
    log("WARN", `state ファイル読み込み失敗 (空で再開): ${(e as Error).message}`);
    return {};
  }
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function newRepoState(): RepoState {
  const now = utcNowIso();
  return {
    issue_comments_max_id: 0,
    pr_review_comments_max_id: 0,
    issue_comments_since: now,
    pr_review_comments_since: now,
  };
}
