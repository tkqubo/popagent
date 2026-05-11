# popagent

Pop an AI agent (Claude Code, etc.) into a fresh tmux + iTerm2 window from
various triggers. Written in TypeScript, runs on Node.js.

> macOS only. Relies on `osascript`, iTerm2, and (optionally) `terminal-notifier`.

## Commands

| Command | What it does |
|---|---|
| `popagent -p "..."` | Default: pop an agent with the given prompt |
| `popagent pr` | Pop an agent for the latest comment **from someone else on your PR** (current branch by default) |
| `popagent pr-polling` | Long-running daemon that polls GitHub and pops an agent whenever a new comment from someone else lands on one of your PRs |

All commands share `lib/pop.ts` which:

1. Starts a detached tmux session running your agent command (e.g. `claude '<prompt>'`)
2. Opens a new iTerm2 window that `tmux attach`es to that session
3. Optionally sends `/rename <title>` via `tmux send-keys` so the agent's session has a friendly name

After the agent exits, the tmux session drops into a login shell so the window
stays open.

### tmux session naming

| Command | Format |
|---|---|
| default (prompt) | `ai-pop-prompt-<epoch>` |
| `pr` | `ai-pop-pr-<pr>-<epoch>` |
| `pr-polling` | `ai-pop-pr-polling-<pr>-<epoch>` |

## Prerequisites (macOS)

| Tool | Why | Install |
|---|---|---|
| [Node.js](https://nodejs.org/) ≥ 18 | Runtime | `brew install node` |
| [GitHub CLI (`gh`)](https://cli.github.com) | Auth + API access (requires `gh auth login`) | `brew install gh` |
| [tmux](https://github.com/tmux/tmux/wiki) | Session manager hosting the agent | `brew install tmux` |
| [iTerm2](https://iterm2.com/) | Terminal that AppleScript can drive | <https://iterm2.com/> |
| [git](https://git-scm.com/) | Branch detection | bundled with Xcode CLT |
| [terminal-notifier](https://github.com/julienXX/terminal-notifier) (optional) | Used only when `auto_attach: false` | `brew install terminal-notifier` |

## Install

```bash
npm install -g popagent
gh auth login
```

That's it — `popagent` is on your `$PATH`.

## Usage

### `popagent -p "..."` — arbitrary prompt (default)

```bash
popagent -p "Summarize the repository layout"
popagent -p "..." -C ~/path/to/repo
popagent -p "..." -t "TF-9341 review"          # sends /rename inside the agent
```

### `popagent pr` — latest comment on your PR

```bash
# Target the PR submitted from the current branch
popagent pr

# Explicit PR URL
popagent pr --pr https://github.com/owner/repo/pull/123
```

The selected comment is the **latest one from someone other than yourself**.
If the PR is not authored by you, the command errors out.

### `popagent pr-polling` — daemon

Create `config.json`:

```json
{
  "pr-polling": {
    "workspaces": [
      { "path": "/path/to/parent", "recursive": true }
    ],
    "ai_agent_command": "claude {comment}",
    "repos": ["owner/repo"],
    "poll_interval_sec": 30,
    "auto_attach": true
  }
}
```

Top-level `github_username` is also accepted; when omitted, `gh api /user` is
used to resolve it.

| Field | Meaning |
|---|---|
| `workspaces` | Directories to search for the PR head branch checkout. String or `{path, recursive}` objects |
| `ai_agent_command` | Command template. `{comment}` is replaced with the shell-quoted comment body |
| `repos` | `owner/name` strings to watch (one or more) |
| `poll_interval_sec` | Polling interval, seconds (default 30) |
| `state_path` | Where last-seen comment IDs are persisted (default `.state/last_seen.json`) |
| `auto_attach` | `true` skips notifications and opens iTerm2 directly (default `false`) |

> Do not wrap `{comment}` in quotes — the body is already shell-quoted inside.

Run:

```bash
popagent pr-polling
```

### `pr-polling` flags

| Flag | Effect |
|---|---|
| `--once` | Run a single polling tick and exit. Still launches agents and updates state. |
| `--dry-run` | Detect comments and log what would happen, but skip tmux + notifications. State is still advanced. |
| `--reset-state` | Delete `.state/last_seen.json` before starting. The "last seen" timestamps reset to "now", so past comments are not re-fired. |

`--once` vs `--dry-run` mental model:

- `--once` decides **how many polling ticks to run** (one and done).
- `--dry-run` decides **whether to launch the agent** (no, just log).
- They are independent and can be combined: `--once --dry-run` is the safest "preview" mode.

## Running as a daemon

```bash
tmux new-session -d -s popagent "popagent pr-polling"
```

For auto-start, drop a `~/Library/LaunchAgents/com.local.popagent.plist` that
calls `popagent pr-polling`.

## Development

```bash
git clone <this-repo>
cd popagent
npm install
npm run typecheck        # tsc --noEmit
npm run build            # tsup → dist/popagent.js
npm run dev -- -p "test" # tsx popagent.ts -p "test"
```

Linking the local build globally:

```bash
npm run build
npm link
popagent --help
```

## Notes

- `gh auth login` is the only credential setup — no PAT environment variable.
- Branch matching uses `git rev-parse --abbrev-ref HEAD` against the PR head ref.
- `.git` as directory (normal repo) and `.git` as file (git worktree) are both detected.
- `recursive` workspace search is one level deep, not recursive into grandchildren.
- On first startup the `since` timestamp is pinned to the current time, so
  pre-existing comments do not fire.
- API cost: roughly 2 requests per repo per tick (well under 5000 req/h authenticated).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `gh command not found` | `brew install gh` |
| `gh is not authenticated` | `gh auth login` |
| `pr-polling.repos must contain at least one owner/name` | Set `pr-polling.repos` in `config.json` |
| `iTerm auto-attach failed` | System Settings → Privacy & Security → Automation → grant access to iTerm |
| Polling never fires | `popagent pr-polling --once --dry-run` to inspect; check that a matching branch is checked out under `workspaces` |
| `pr` says "no PR found for current branch" | You are not on a branch with an open PR. Pass `--pr <URL>` explicitly |

## License

[MIT](./LICENSE)
