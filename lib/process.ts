/**
 * Thin subprocess + sleep helpers (Node compatible).
 *
 * Centralised here so the rest of the codebase doesn't depend on a particular
 * runtime's spawn API.
 */
import { spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";

export interface ProcResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface RunSyncOptions {
  cwd?: string;
  timeoutMs?: number;
}

export function runSync(cmd: string[], opts: RunSyncOptions = {}): ProcResult {
  if (cmd.length === 0) {
    return { exitCode: -1, stdout: "", stderr: "empty command", error: new Error("empty command") };
  }
  const [bin, ...args] = cmd;
  const spawnOpts: SpawnSyncOptionsWithBufferEncoding = {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    encoding: "buffer",
  };
  const res = spawnSync(bin!, args, spawnOpts);
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ? res.stdout.toString("utf-8") : "",
    stderr: res.stderr ? res.stderr.toString("utf-8") : "",
    error: res.error,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
