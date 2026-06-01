# popagent

Pop an AI coding agent (Claude Code / Codex / Cursor Agent) into a fresh
tmux + iTerm2 window from a prompt. Written in TypeScript, runs on Node.js.

> macOS only. Relies on `osascript`, iTerm2, and a built-in Swift notification helper.

## What it does

`popagent -p "<prompt>" [--agent <kind>]`:

1. Starts a detached tmux session running the chosen agent with the prompt as its initial argument
2. By default, opens a new iTerm2 window that `tmux attach`es to that session
   (or sends a clickable macOS notification when `--attach notify` is used)
3. Optionally sends `/rename <title>` via `tmux send-keys` so the agent's session has a friendly name (all three supported agents implement `/rename`)

After the agent exits, the tmux session drops into a login shell so the window
stays open.

Supported agents:

| `--agent` value | CLI command invoked | Notes |
|---|---|---|
| `claude` (default) | `claude "<prompt>"` | Claude Code |
| `codex` | `codex "<prompt>"` | OpenAI Codex CLI |
| `cursor` | `agent "<prompt>"` | Cursor Agent CLI (binary name: `agent`) |

tmux session name format: `ai-pop-<agent>-<epoch>` (override with `-s`).

## Prerequisites (macOS)

| Tool | Why | Install |
|---|---|---|
| [Node.js](https://nodejs.org/) ≥ 18 | Runtime | `brew install node` |
| [tmux](https://github.com/tmux/tmux/wiki) | Session manager hosting the agent | `brew install tmux` |
| [iTerm2](https://iterm2.com/) | Terminal that AppleScript can drive | `brew install --cask iterm2` |
| Xcode Command Line Tools (`swiftc`) | Build/run bundled notification helper (`--attach notify`) | `xcode-select --install` |
| [GitHub CLI](https://cli.github.com/) (`gh`) | PR polling for `popagent watch` (run `gh auth login`) | `brew install gh` |

## Install

```bash
npm install -g popagent
```

That's it — `popagent` is on your `$PATH`.

## Usage

```bash
popagent -p "Summarize the repository layout"
popagent -p "..." --agent codex                # spawn codex instead of claude
popagent -p "..." --agent cursor               # spawn cursor agent
popagent -p "..." --attach notify              # clickable notification (Swift helper) instead of immediate iTerm attach
popagent -p "..." -C ~/path/to/repo
popagent -p "..." -t "TF-9341 review"          # sends /rename inside the agent
popagent -p "..." -s my-session                # custom tmux session name
```

`popagent -p "..."` is shorthand for the `prompt` subcommand (`popagent prompt -p "..."`); both forms are equivalent.

## Watch a PR for new comments

`popagent watch --pr <number>` polls a GitHub PR on an interval and, whenever
new comments arrive, pops an agent with those comments as its prompt. It is a
foreground process — it keeps running until you stop it with Ctrl-C.

```bash
popagent watch --pr 123                         # poll PR #123 every 5 min
popagent watch --pr 123,124,125                 # watch multiple PRs in the same repo
popagent watch --pr 123 --interval 2            # poll every 2 min
popagent watch --pr 123 --lazy                  # notify only; pop on click
popagent watch --pr 123 --agent codex           # spawn codex on new comments
popagent watch --pr 123 -C ~/path/to/repo       # repo to resolve the PR against
popagent watch --pr 123 --include-self          # also react to your own comments
popagent watch --pr 123 --since 1h              # also catch up on items from the last hour
popagent watch --pr 123 --filter off            # disable the AI "non-issue" filter
```

| Flag | Effect |
|---|---|
| `--pr` (required) | PR number(s) to watch (comma-separated for multiple PRs in the same repo, e.g. `4298,4300,4310`). All numbers resolve against the repo at `--cwd` |
| `--interval` | Polling interval in minutes (default: 5) |
| `--lazy` | Send a notification only; the agent starts when you click it. Without `--lazy`, the tmux session is created immediately and the notification just attaches to it |
| `--include-self` | React to your own comments too. By default the authenticated `gh` user's comments are excluded to avoid feedback loops |
| `--since <dur>` | Shift the baseline back so items from this far in the past are picked up on the first poll. Format: `<n><unit>` where unit is `s\|m\|h\|d` (e.g. `30m`, `1h`, `2d`). Default: baseline = watcher start time |
| `--filter <mode>` | AI-driven comment filter run before popping. `non-issue` (default) asks the agent in headless mode (`claude -p`, `codex exec`) to judge each new comment; LGTM/ack-style comments are dropped, anything ambiguous still pops. `off` disables the filter entirely. Agents without a headless mode (currently `cursor`) silently fall back to `off` |
| `--agent` / `-C` | Same meaning as the `prompt` subcommand |

Details:

- Watches three kinds of feedback:
  - Conversation comments (the PR's "Conversation" tab).
  - Code-line review comments (individual comments anchored to a diff line).
  - Review submissions with a non-empty body (the summary written when submitting "Comment" / "Request changes" / "Approve"). Bare approvals with no body are ignored.
- AI classifications are cached on disk at `$XDG_CACHE_HOME/popagent/filter-cache.json` (default `~/.cache/popagent/filter-cache.json`). Restarting watch (e.g. with `--since 4d`) doesn't re-spend AI calls on already-judged comments. If a comment is edited later, its `updated_at` makes the cached entry stale and it is re-judged. Entries older than 90 days are pruned automatically. Delete the file to start fresh.
- Only reacts to feedback posted **after** the watcher starts; pre-existing items are ignored.
- Multiple new items seen in a single poll **on the same PR** are batched into one agent pop. Different PRs always get their own pop (separate tmux session per PR).
- Requires `gh` to be installed and authenticated (`gh auth login`).

## Configuration

Optional user-level config at `~/.config/popagent/config.json` (override path
with `$XDG_CONFIG_HOME`):

```json
{
  "defaultAgent": "codex"
}
```

| Field | Type | Effect |
|---|---|---|
| `defaultAgent` | `"claude"` \| `"codex"` \| `"cursor"` | Agent to spawn when `--agent` is not passed (built-in fallback: `claude`) |

`--agent` on the command line always overrides this.

## Development

This repo is developed with [Bun](https://bun.sh) — `bun install` populates
`node_modules/` and regenerates `bun.lock`.

```bash
git clone <this-repo>
cd popagent
bun install
bun run typecheck         # tsc --noEmit
bun run build             # tsup → dist/popagent.js
bun run dev -- -p "test"  # bun popagent.ts -p "test" (TS runs directly)
```

Linking the local build globally:

```bash
bun run build
bun link
popagent --help
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `tmux: command not found` | `brew install tmux` |
| `swiftc not found` | `xcode-select --install` |
| `--attach notify` で通知が出ない/クリックで開かない | System Settings → Notifications で `popagent-notifier` を許可。必要なら `killall NotificationCenter usernoted` 後に再試行 |
| `iTerm auto-attach failed` | System Settings → Privacy & Security → Automation → grant access to iTerm |
| `popagent watch` で `gh ... failed` / 認証エラー | `brew install gh` の上で `gh auth login`。`gh repo view` が当該リポジトリで通るか確認 |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, code style
notes, and the release flow. Discussion of new features is welcome via
[GitHub Discussions](https://github.com/tkqubo/popagent/discussions) or a
feature-request issue.

This project adheres to the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## Security

For security-sensitive reports, please follow the private disclosure flow in
[SECURITY.md](./SECURITY.md). Do not file public issues for vulnerabilities.

## License

[MIT](./LICENSE)
