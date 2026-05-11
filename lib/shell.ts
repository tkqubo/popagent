/**
 * POSIX shell helpers.
 */
import { runSync } from "./process.ts";

/**
 * POSIX sh: wrap in single quotes and replace any inner ' with '"'"'.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Resolve a command name to its absolute path via `which`. Returns null if not found.
 */
export function whichSync(cmd: string): string | null {
  const r = runSync(["which", cmd]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}
