/**
 * On-disk cache of comment classifications so the AI filter doesn't re-judge
 * the same comment across watch process restarts (notably when `--since` is
 * used to backfill).
 *
 * Storage: JSON at `$XDG_CACHE_HOME/popagent/filter-cache.json` (default
 * `~/.cache/popagent/filter-cache.json`). Format is versioned so we can break
 * compatibility cleanly later if needed.
 *
 * Caching policy:
 *   - Only definitive verdicts (`needs_action` / `non_issue`) are stored.
 *     `uncertain` represents a transient failure and is retried next time.
 *   - Entries older than 90 days are dropped at load time.
 *   - The cache is keyed by `<repo_slug>:<comment.key>` and is **shared across
 *     agents** — a comment that one agent already classified is assumed to be
 *     classifiable by any agent. Agent name + timestamp are stored as metadata.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Logger } from "./log.ts";

export type CachedVerdict = "needs_action" | "non_issue";

export interface CachedEntry {
  classification: CachedVerdict;
  /** Agent that produced this judgment (informational). */
  agent: string;
  /** ISO-8601 timestamp of when this entry was written. */
  at: string;
}

const FILE_VERSION = 1;
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

interface DiskFormat {
  version: number;
  entries: Record<string, CachedEntry>;
}

export class FilterCache {
  readonly path: string;
  private readonly log: Logger;
  private readonly entries = new Map<string, CachedEntry>();
  private dirty = false;
  private loaded = false;

  constructor(path: string, log: Logger) {
    this.path = path;
    this.log = log;
  }

  static defaultPath(): string {
    const xdg = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
    return join(xdg, "popagent", "filter-cache.json");
  }

  get size(): number {
    return this.entries.size;
  }

  /** Load from disk. Safe to call once at startup; later calls are no-ops. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;

    let parsed: DiskFormat | undefined;
    try {
      const raw = readFileSync(this.path, "utf8");
      parsed = JSON.parse(raw) as DiskFormat;
    } catch (e) {
      this.log(
        "WARN",
        `filter cache: failed to load ${this.path}: ${(e as Error).message}; starting fresh`,
      );
      return;
    }

    if (!parsed || parsed.version !== FILE_VERSION || typeof parsed.entries !== "object") {
      this.log(
        "WARN",
        `filter cache: unsupported file format (version=${parsed?.version}); starting fresh`,
      );
      return;
    }

    const cutoff = Date.now() - PRUNE_AGE_MS;
    let pruned = 0;
    for (const [k, v] of Object.entries(parsed.entries)) {
      if (!v || typeof v.classification !== "string" || typeof v.at !== "string") continue;
      const ts = Date.parse(v.at);
      if (Number.isFinite(ts) && ts < cutoff) {
        pruned++;
        continue;
      }
      this.entries.set(k, v);
    }
    if (pruned > 0) this.dirty = true;
  }

  get(key: string): CachedEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, classification: CachedVerdict, agent: string): void {
    this.entries.set(key, {
      classification,
      agent,
      at: new Date().toISOString(),
    });
    this.dirty = true;
  }

  /** Persist if there are unsaved changes. Safe to call after every poll. */
  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const data: DiskFormat = {
        version: FILE_VERSION,
        entries: Object.fromEntries(this.entries),
      };
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (e) {
      this.log("WARN", `filter cache: failed to write ${this.path}: ${(e as Error).message}`);
    }
  }
}
