/**
 * Pop an agent for the latest comment by someone else on your PR.
 *
 * Exports `popPrCommand`, consumed by `popagent.ts`.
 */
import { defineCommand } from "citty";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertGhReady,
  getGithubUsername,
  ghApi,
  GhError,
} from "./lib/gh.ts";
import { makeLogger } from "./lib/log.ts";
import { pop } from "./lib/pop.ts";
import { runSync } from "./lib/process.ts";

const log = makeLogger("pop-pr");

interface Comment {
  id: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
}

interface PrStatusResponse {
  currentBranch?: {
    number?: number;
    headRefName?: string;
    headRepository?: { name?: string };
    headRepositoryOwner?: { login?: string };
  };
}

interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

interface PrInfo {
  user?: { login?: string };
}

function parsePrUrl(url: string): PrRef | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]!) };
}

function resolveCurrentPr(cwd: string): PrRef {
  const gitCheck = runSync(["git", "-C", cwd, "rev-parse", "--git-dir"], {
    timeoutMs: 3000,
  });
  if (gitCheck.exitCode !== 0) {
    throw new Error(
      `cwd is not a git directory: ${cwd}\n` +
        `pass --pr <URL> or run inside a git repo`,
    );
  }

  const res = runSync(
    [
      "gh", "pr", "status",
      "--json", "number,headRefName,headRepository,headRepositoryOwner",
    ],
    { cwd, timeoutMs: 10000 },
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `gh pr status failed: ${res.stderr.trim()}\n` +
        `cwd is likely not a GitHub repo. pass --pr <URL> explicitly`,
    );
  }
  let data: PrStatusResponse;
  try {
    data = JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`gh pr status returned non-JSON: ${(e as Error).message}`);
  }
  const pr = data.currentBranch;
  if (!pr?.number || !pr.headRepository?.name || !pr.headRepositoryOwner?.login) {
    throw new Error(
      `no PR found for the current branch in ${cwd}\n` +
        `pass --pr <URL> explicitly`,
    );
  }
  return {
    owner: pr.headRepositoryOwner.login,
    repo: pr.headRepository.name,
    number: pr.number,
  };
}

function pickLatest(comments: Comment[]): Comment | null {
  if (comments.length === 0) return null;
  const sorted = [...comments].sort(
    (a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
  return sorted[sorted.length - 1] ?? null;
}

export const popPrCommand = defineCommand({
  meta: {
    name: "pr",
    description:
      "Pop an agent for the latest comment from someone else on your PR " +
      "(current branch by default)",
  },
  args: {
    pr: {
      type: "string",
      description:
        "Target PR URL (https://github.com/<owner>/<repo>/pull/<n>). " +
        "Defaults to the PR submitted from the current branch.",
    },
    cwd: {
      type: "string",
      alias: "C",
      description: "Working directory (default: current cwd)",
    },
  },
  async run({ args }) {
    const cwd = resolve(args.cwd ?? process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      log("ERROR", `cwd is not a directory: ${cwd}`);
      process.exit(2);
    }

    try {
      assertGhReady();
    } catch (e) {
      log("ERROR", (e as Error).message);
      process.exit(1);
    }

    let prRef: PrRef;
    if (args.pr) {
      const parsed = parsePrUrl(args.pr);
      if (!parsed) {
        log(
          "ERROR",
          `invalid PR URL: ${args.pr}\n` +
            `expected: https://github.com/<owner>/<repo>/pull/<number>`,
        );
        process.exit(2);
      }
      prRef = parsed;
    } else {
      try {
        prRef = resolveCurrentPr(cwd);
      } catch (e) {
        log("ERROR", (e as Error).message);
        process.exit(2);
      }
    }

    const repoFullName = `${prRef.owner}/${prRef.repo}`;
    log("INFO", `target: ${repoFullName}#${prRef.number}`);

    let username: string;
    try {
      username = getGithubUsername();
    } catch (e) {
      log("ERROR", (e as Error).message);
      process.exit(1);
    }

    let prInfo: PrInfo;
    try {
      prInfo = ghApi(`/repos/${repoFullName}/pulls/${prRef.number}`) as PrInfo;
    } catch (e) {
      if (e instanceof GhError && /404/.test(e.message)) {
        log("ERROR", `PR not found: ${repoFullName}#${prRef.number}`);
      } else {
        log("ERROR", `failed to fetch PR: ${(e as Error).message}`);
      }
      process.exit(1);
    }
    if (prInfo.user?.login !== username) {
      log(
        "ERROR",
        `PR ${repoFullName}#${prRef.number} was not opened by you ` +
          `(author=${prInfo.user?.login}, you=${username}). ` +
          `pop-pr targets comments on your own PRs only.`,
      );
      process.exit(1);
    }

    let issueComments: Comment[];
    let reviewComments: Comment[];
    try {
      issueComments = ghApi(
        `/repos/${repoFullName}/issues/${prRef.number}/comments?per_page=100`,
        { paginate: true },
      ) as Comment[];
      reviewComments = ghApi(
        `/repos/${repoFullName}/pulls/${prRef.number}/comments?per_page=100`,
        { paginate: true },
      ) as Comment[];
    } catch (e) {
      log("ERROR", `failed to fetch comments: ${(e as Error).message}`);
      process.exit(1);
    }

    const allComments = [
      ...(Array.isArray(issueComments) ? issueComments : []),
      ...(Array.isArray(reviewComments) ? reviewComments : []),
    ];
    const others = allComments.filter(
      (c) => c.user?.login && c.user.login !== username,
    );
    if (others.length === 0) {
      log(
        "ERROR",
        `no comments from others on ${repoFullName}#${prRef.number}`,
      );
      process.exit(1);
    }

    const selected = pickLatest(others);
    if (!selected) {
      log("ERROR", "failed to pick latest comment");
      process.exit(1);
    }

    const preview = (selected.body ?? "").slice(0, 100).replace(/\n/g, " ");
    log(
      "INFO",
      `latest comment by ${selected.user?.login}: id=${selected.id} preview=${JSON.stringify(preview)}`,
    );

    const session = `ai-pop-pr-${prRef.number}-${Math.floor(Date.now() / 1000)}`;
    const result = await pop({
      prompt: selected.body ?? "",
      cwd,
      sessionName: session,
      title: `pr-${prRef.number}`,
      autoAttach: true,
      log,
    });
    if (!result.ok) {
      log("ERROR", result.error);
      process.exit(1);
    }
    log("INFO", `launched: session=${result.session} cwd=${result.cwd}`);
  },
});

