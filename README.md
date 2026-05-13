# popagent

Pop an AI coding agent (Claude Code / Codex / Cursor Agent) into a fresh
tmux + iTerm2 window from a prompt. Written in TypeScript, runs on Node.js.

> macOS only. Relies on `osascript` and iTerm2.

## What it does

`popagent -p "<prompt>" [--agent <kind>]`:

1. Starts a detached tmux session running the chosen agent with the prompt as its initial argument
2. Opens a new iTerm2 window that `tmux attach`es to that session
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
popagent -p "..." -C ~/path/to/repo
popagent -p "..." -t "TF-9341 review"          # sends /rename inside the agent
popagent -p "..." -s my-session                # custom tmux session name
```

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
| `iTerm auto-attach failed` | System Settings → Privacy & Security → Automation → grant access to iTerm |

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
