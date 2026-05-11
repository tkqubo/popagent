#!/usr/bin/env node
/**
 * popagent — pop an AI agent into tmux + iTerm2 from a prompt.
 *
 * Usage:
 *   popagent -p "prompt"   Pop an agent with the given prompt
 *   popagent --help        Show available flags
 */
import { runMain } from "citty";
import { popPromptCommand } from "./pop-prompt.ts";

await runMain(popPromptCommand);
