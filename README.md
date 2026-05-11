# popagent

Pop an AI agent (Claude Code, etc.) into a fresh tmux + iTerm2 window from a
prompt. Written in TypeScript, runs on Node.js.

> macOS only. Relies on `osascript` and iTerm2.

## What it does

`popagent -p "<prompt>"`:

1. Starts a detached tmux session running `claude '<prompt>'`
2. Opens a new iTerm2 window that `tmux attach`es to that session
3. Optionally sends `/rename <title>` via `tmux send-keys` so the agent's session has a friendly name

After the agent exits, the tmux session drops into a login shell so the window
stays open.

tmux session name format: `ai-pop-prompt-<epoch>` (override with `-s`).

## Prerequisites (macOS)

| Tool | Why | Install |
|---|---|---|
| [Node.js](https://nodejs.org/) ≥ 18 | Runtime | `brew install node` |
| [tmux](https://github.com/tmux/tmux/wiki) | Session manager hosting the agent | `brew install tmux` |
| [iTerm2](https://iterm2.com/) | Terminal that AppleScript can drive | <https://iterm2.com/> |

## Install

```bash
npm install -g popagent
```

That's it — `popagent` is on your `$PATH`.

## Usage

```bash
popagent -p "Summarize the repository layout"
popagent -p "..." -C ~/path/to/repo
popagent -p "..." -t "TF-9341 review"          # sends /rename inside the agent
popagent -p "..." -s my-session                # custom tmux session name
```

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| `tmux: command not found` | `brew install tmux` |
| `iTerm auto-attach failed` | System Settings → Privacy & Security → Automation → grant access to iTerm |

## License

[MIT](./LICENSE)
