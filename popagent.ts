#!/usr/bin/env node
/**
 * popagent — pop an AI agent into tmux + iTerm2 from various triggers.
 *
 * Usage:
 *   popagent -p "prompt"                  Default: pop an agent with the given prompt
 *   popagent pr [--pr URL]                Pop for the latest comment on your PR
 *   popagent pr-polling [options]         Daemon mode
 *   popagent --help                       Show all subcommands
 *   popagent <subcommand> --help          Subcommand-specific help
 */
import { defineCommand, runMain } from "citty";
import { popPrCommand } from "./pop-pr.ts";
import { popPrPollingCommand } from "./pop-pr-polling.ts";
import { popPromptCommand } from "./pop-prompt.ts";

const main = defineCommand({
  meta: {
    name: "popagent",
    description: "Pop an AI agent into tmux + iTerm2 from various triggers (macOS)",
  },
  // Default behavior: same as `popagent prompt …`. When the first positional
  // arg matches a subcommand name, citty dispatches to that subcommand instead.
  args: popPromptCommand.args,
  run: popPromptCommand.run,
  subCommands: {
    pr: popPrCommand,
    "pr-polling": popPrPollingCommand,
  },
});

await runMain(main);
