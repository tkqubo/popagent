/**
 * Quote helpers for POSIX shell and AppleScript.
 */
import { runSync } from "./process.ts";

/**
 * POSIX sh: wrap in single quotes and replace any inner ' with '"'"'.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * AppleScript string literal ("..."): escape \ and ".
 */
export function applescriptQuote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Resolve a command name to its absolute path via `which`. Returns null if not found.
 */
export function whichSync(cmd: string): string | null {
  const r = runSync(["which", cmd]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}
