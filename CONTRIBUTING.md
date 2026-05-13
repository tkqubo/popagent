# Contributing to popagent

Thanks for your interest in helping out. popagent is a small macOS-only CLI,
so the contribution surface is intentionally narrow. The notes below should
get you from a clean clone to a working build.

## Development setup

Prerequisites: Node.js ≥ 18, [Bun](https://bun.sh) (used as the dev runner),
tmux, iTerm2.

```bash
git clone https://github.com/tkqubo/popagent.git
cd popagent
bun install
```

## Common tasks

```bash
bun run typecheck          # tsc --noEmit
bun run build              # tsup → dist/popagent.js
bun run dev -- -p "test"   # bun popagent.ts -p "test"
bun popagent.ts -p "test"  # same thing, shorter
```

Run the dev command against your own config:

```bash
bun popagent.ts -p "hello"               # default agent (claude)
bun popagent.ts -p "hello" --agent codex # try a different agent
```

## Code style

- TypeScript strict mode, ESM only.
- Keep modules small and explicit. The lib/ folder hosts shared helpers
  (logging, shell quoting, agent registry, etc.); CLI entry points live at
  the repo root.
- Don't add comments that restate the code. Use them for the *why* — hidden
  constraints, workarounds, surprising invariants.
- No new dependencies without a clear reason. The bundle is shipped to
  npm as a single file, and every extra dep grows it.

## Submitting changes

1. Open an issue first if the change is non-trivial (new agent, new flag,
   reshape of the public surface).
2. Branch from `main`, keep commits focused, write commit messages that
   explain the *why*.
3. Run `bun run typecheck && bun run build` locally before opening the PR.
4. Fill out the PR template. Screenshots / `asciinema` recordings are
   welcome for anything visible to end users.

## Releasing (maintainers only)

Releases are driven by git tags. The workflow at
`.github/workflows/release.yml` publishes to npm on every `v*` tag push.

```bash
npm version patch    # or minor / major — bumps package.json + creates tag
git push --follow-tags
```

GitHub Actions will:

1. Re-run typecheck + build.
2. Publish to npm with provenance attestation (`--provenance`).
3. Create a GitHub Release from the tag.

## Code of conduct

This project follows the
[Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to
its terms.
