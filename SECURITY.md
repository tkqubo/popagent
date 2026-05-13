# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Use one of these private channels instead:

- [GitHub Security Advisory](https://github.com/tkqubo/popagent/security/advisories/new)
  (preferred)
- Email the maintainer listed in `package.json`

We will acknowledge the report within a few business days and aim to ship a
fix in a patch release. Coordinated disclosure timelines can be arranged
case-by-case.

## Supported versions

popagent is pre-1.0 and only the latest minor version on npm is supported.
Older versions will not receive security backports.

## Scope

popagent is a thin macOS-only launcher that shells out to tmux, iTerm2, and a
configured AI agent CLI (`claude` / `codex` / `agent`). Reports about those
upstream tools should be filed with their respective projects.

In-scope examples for popagent itself:

- Shell-quoting bypasses around the prompt/title arguments.
- Path traversal or symlink attacks via config-loading code.
- Arbitrary command execution beyond what the CLI flags advertise.
