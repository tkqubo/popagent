/**
 * popagent — pop an AI agent into tmux + iTerm2 from a prompt.
 *
 * Usage:
 *   popagent -p "prompt"        Pop an agent with the given prompt (default subcommand)
 *   popagent prompt -p "..."    Same, explicit form
 *   popagent watch --pr 123     Watch a PR for new comments and pop on each
 *   popagent --help             Show available subcommands and flags
 */
import { defineCommand, runMain } from "citty";
import { popPromptArgs, popPromptCommand } from "./pop-prompt.ts";
import { watchCommand } from "./watch-pr.ts";

// citty's subcommand detector treats the first non-flag token as a subcommand
// name. To keep the top-level `popagent -p "..."` form working, the root must
// declare the prompt command's value-flags so their values are skipped rather
// than mistaken for a subcommand. `required` is dropped here because the root
// itself never runs — it delegates to the `prompt` default.
const rootArgs = {
  ...popPromptArgs,
  prompt: { ...popPromptArgs.prompt, required: false },
} as const;

const main = defineCommand({
  meta: {
    name: "popagent",
    description: "Pop an AI agent into tmux + iTerm2 from a prompt (macOS)",
  },
  args: rootArgs,
  subCommands: {
    prompt: popPromptCommand,
    watch: watchCommand,
  },
  default: "prompt",
});

await runMain(main);
