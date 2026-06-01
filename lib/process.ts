/**
 * Thin subprocess + sleep helpers (Node compatible).
 *
 * Centralised here so the rest of the codebase doesn't depend on a particular
 * runtime's spawn API.
 */
import {
  type SpawnOptions,
  type SpawnSyncOptionsWithBufferEncoding,
  spawn,
  spawnSync,
} from "node:child_process";

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

export interface DetachedResult {
  ok: boolean;
  pid?: number;
  error?: Error;
}

export function runSync(cmd: string[], opts: RunSyncOptions = {}): ProcResult {
  const [bin, ...args] = cmd;
  if (!bin) {
    return { exitCode: -1, stdout: "", stderr: "empty command", error: new Error("empty command") };
  }
  const spawnOpts: SpawnSyncOptionsWithBufferEncoding = {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    encoding: "buffer",
  };
  const res = spawnSync(bin, args, spawnOpts);
  return {
    exitCode: res.status ?? -1,
    stdout: res.stdout ? res.stdout.toString("utf-8") : "",
    stderr: res.stderr ? res.stderr.toString("utf-8") : "",
    error: res.error,
  };
}

export function runDetached(cmd: string[], opts: RunSyncOptions = {}): DetachedResult {
  const [bin, ...args] = cmd;
  if (!bin) {
    return { ok: false, error: new Error("empty command") };
  }
  try {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      detached: true,
      stdio: "ignore",
    };
    const child = spawn(bin, args, spawnOpts);
    child.unref();
    return { ok: true, pid: child.pid ?? undefined };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
