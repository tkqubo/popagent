/**
 * AI-driven classification of PR comments so that ack-style "non-issue"
 * comments (LGTM / thanks / approvals) don't trigger a pop.
 *
 * Each comment is judged in isolation by the configured agent's headless
 * mode (e.g. `claude -p`, `codex exec`). Thread context, resolved state and
 * cross-comment reasoning are out of scope for v1.
 */
import type { AgentSpec } from "./agent.ts";
import type { PrComment } from "./github.ts";
import type { Logger } from "./log.ts";
import { runSync } from "./process.ts";

export type FilterMode = "non-issue" | "off";

export type Classification = "needs_action" | "non_issue" | "uncertain";

/** Max length of the one-line summary surfaced in the notification subtitle. */
export const SUMMARY_MAX_CHARS = 48;

export interface ClassifyResult {
  classification: Classification;
  /**
   * One-line imperative summary of what the comment asks for, for the
   * notification subtitle. `null` when not extractable (parse failure,
   * `uncertain`, or a `non_issue` that needs no summary).
   */
  summary: string | null;
}

export const FILTER_MODES: FilterMode[] = ["non-issue", "off"];

export function isFilterMode(v: string): v is FilterMode {
  return (FILTER_MODES as readonly string[]).includes(v);
}

/**
 * Pre-flight: can the given agent + mode combination actually filter?
 *   - mode=off            → no
 *   - agent has no headless → no (fall back to "pop everything")
 *   - otherwise            → yes
 */
export function filterEnabled(mode: FilterMode, agent: AgentSpec): boolean {
  if (mode === "off") return false;
  return typeof agent.headlessRun === "function";
}

/**
 * Decide whether a comment with the given classification should be popped
 * under the given mode.
 *
 *   - "off"        → always pop
 *   - "non-issue"  → pop unless classified as `non_issue`; uncertain ⇒ pop
 *                    (we lean toward over-notifying when the AI fails).
 */
export function shouldPop(classification: Classification, mode: FilterMode): boolean {
  if (mode === "off") return true;
  return classification !== "non_issue";
}

const BODY_CLAMP = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ask the agent's headless mode whether a single comment requires a code/text
 * response. Returns `"uncertain"` for any failure (spawn error, non-zero
 * exit, unparseable output) — callers should pop on uncertain.
 */
export async function classifyComment(
  comment: PrComment,
  agent: AgentSpec,
  log: Logger,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ClassifyResult> {
  if (!agent.headlessRun) return { classification: "uncertain", summary: null };
  const prompt = buildPrompt(comment);
  const { command, args } = agent.headlessRun(prompt);
  const r = runSync([command, ...args], { timeoutMs });
  if (r.error || r.exitCode !== 0) {
    log(
      "WARN",
      `filter: ${command} ${comment.key} exited ${r.exitCode}` +
        (r.stderr.trim() ? ` stderr=${r.stderr.trim().slice(0, 200)}` : ""),
    );
    return { classification: "uncertain", summary: null };
  }
  const classification = parseClassification(r.stdout);
  return {
    classification,
    summary: classification === "needs_action" ? parseSummary(r.stdout) : null,
  };
}

function buildPrompt(comment: PrComment): string {
  const clamped =
    comment.body.length > BODY_CLAMP
      ? `${comment.body.slice(0, BODY_CLAMP)}…[truncated]`
      : comment.body;
  const where =
    comment.kind === "review" && comment.path
      ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}`
      : "";
  const kindLabel =
    comment.kind === "review_summary"
      ? `review submission${comment.reviewState ? ` (${comment.reviewState})` : ""}`
      : comment.kind === "review"
        ? "code-line review comment"
        : "PR conversation comment";

  return [
    "You are a triage classifier deciding whether a GitHub PR comment requires a code or text response from the PR author.",
    "",
    "Reply with EXACTLY two lines and nothing else:",
    "  Line 1: one token — NEEDS_ACTION or NON_ISSUE",
    "    NEEDS_ACTION  — the author should respond or change code",
    "    NON_ISSUE     — pure acknowledgement, approval, thanks, FYI, or otherwise no action needed",
    `  Line 2: SUMMARY: <imperative one-line summary of the requested action, ${SUMMARY_MAX_CHARS} chars max>`,
    "    Only when NEEDS_ACTION. For NON_ISSUE write 'SUMMARY:' with nothing after it.",
    "",
    "Lean toward NEEDS_ACTION whenever there is any ambiguity.",
    "",
    `--- ${kindLabel} by @${comment.author}${where} ---`,
    clamped,
    "---",
    "",
    "Answer:",
  ].join("\n");
}

/**
 * Extract the `SUMMARY:` line the classifier was asked to emit. Tolerant of
 * leading whitespace, markdown bullets, and surrounding quotes. Returns `null`
 * when no non-empty summary is present.
 */
function parseSummary(stdout: string): string | null {
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = rawLine.match(/summary:\s*(.*)$/i);
    if (!match) continue;
    const value = match[1]
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (value.length === 0) return null;
    return value.length > SUMMARY_MAX_CHARS ? `${value.slice(0, SUMMARY_MAX_CHARS - 1)}…` : value;
  }
  return null;
}

function parseClassification(stdout: string): Classification {
  // The model is asked for a single token, but real outputs often have leading
  // whitespace, trailing punctuation, or a brief explanation. Match the first
  // occurrence of either keyword anywhere in the output.
  const upper = stdout.toUpperCase();
  const needs = upper.indexOf("NEEDS_ACTION");
  const non = upper.indexOf("NON_ISSUE");
  if (needs === -1 && non === -1) return "uncertain";
  if (needs === -1) return "non_issue";
  if (non === -1) return "needs_action";
  // Both keywords appeared — trust the first one.
  return needs < non ? "needs_action" : "non_issue";
}
