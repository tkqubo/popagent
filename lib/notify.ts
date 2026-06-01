/**
 * macOS notification helpers.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "./log.ts";
import { runDetached, runSync } from "./process.ts";
import { shellQuote, whichSync } from "./shell.ts";

const HELPER_NAME = "popagent-notifier";
const HELPER_TTL_SECONDS = 600;

interface HelperPaths {
  cacheDir: string;
  appDir: string;
  contentsDir: string;
  macosDir: string;
  resourcesDir: string;
  sourcePath: string;
  plistPath: string;
  pkgInfoPath: string;
  hashPath: string;
  binaryPath: string;
  iconPath: string;
}

function resolveBundledResource(filename: string): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "resources", filename),
    join(moduleDir, "resources", filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function helperPaths(): HelperPaths {
  const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  const cacheDir = join(xdgCache, "popagent");
  const appDir = join(homedir(), "Applications", `${HELPER_NAME}.app`);
  const contentsDir = join(appDir, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  const resourcesDir = join(contentsDir, "Resources");
  return {
    cacheDir,
    appDir,
    contentsDir,
    macosDir,
    resourcesDir,
    sourcePath: join(cacheDir, `${HELPER_NAME}.swift`),
    plistPath: join(contentsDir, "Info.plist"),
    pkgInfoPath: join(contentsDir, "PkgInfo"),
    hashPath: join(cacheDir, `${HELPER_NAME}.sha256`),
    binaryPath: join(macosDir, HELPER_NAME),
    iconPath: join(resourcesDir, "AppIcon.icns"),
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function helperInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${HELPER_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>dev.tkqubo.popagent.notify-helper</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${HELPER_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.1.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
`;
}

function ensureNotificationHelper(log: Logger): string | null {
  const swiftcPath = whichSync("swiftc");
  if (!swiftcPath) {
    log("WARN", "swiftc not found. Install Xcode Command Line Tools (`xcode-select --install`).");
    return null;
  }

  const bundledSourcePath = resolveBundledResource("notify-helper.swift");
  if (!bundledSourcePath) {
    log("WARN", "notify-helper.swift not found in package resources.");
    return null;
  }
  const bundledIconPath = resolveBundledResource("AppIcon.icns");
  if (!bundledIconPath) {
    log("WARN", "AppIcon.icns not found in package resources; notification will use default icon.");
  }

  let source: string;
  try {
    source = readFileSync(bundledSourcePath, "utf8");
  } catch (e) {
    log("WARN", `failed to read bundled notifier source: ${(e as Error).message}`);
    return null;
  }

  let iconBytes: Buffer | null = null;
  if (bundledIconPath) {
    try {
      iconBytes = readFileSync(bundledIconPath);
    } catch (e) {
      log("WARN", `failed to read bundled AppIcon.icns: ${(e as Error).message}`);
    }
  }

  const paths = helperPaths();
  const plist = helperInfoPlist();
  // Mix the icon bytes into the cache hash so an icon-only change still rebuilds the bundle.
  const iconDigest = iconBytes ? createHash("sha256").update(iconBytes).digest("hex") : "no-icon";
  const sourceHash = hashText(`${source}\n${plist}\n${iconDigest}`);
  let needBuild = !existsSync(paths.binaryPath) || !existsSync(paths.hashPath);

  if (!needBuild) {
    try {
      const currentHash = readFileSync(paths.hashPath, "utf8").trim();
      if (currentHash !== sourceHash) needBuild = true;
    } catch {
      needBuild = true;
    }
  }

  if (!needBuild) {
    return paths.appDir;
  }

  mkdirSync(paths.cacheDir, { recursive: true });
  mkdirSync(paths.macosDir, { recursive: true });
  mkdirSync(paths.resourcesDir, { recursive: true });
  writeFileSync(paths.sourcePath, source, "utf8");
  writeFileSync(paths.plistPath, plist, "utf8");
  writeFileSync(paths.pkgInfoPath, "APPL????", "utf8");

  const compileCmd = [swiftcPath, "-O", paths.sourcePath, "-o", paths.binaryPath];
  log("INFO", `swiftc: ${compileCmd.map(shellQuote).join(" ")}`);
  const r = runSync(compileCmd, { timeoutMs: 120000 });
  if (r.error || r.exitCode !== 0) {
    const stderr = r.stderr.trim();
    log(
      "WARN",
      `swift helper compile failed: ${r.error?.message ?? `exit ${r.exitCode}`}${stderr ? ` stderr=${stderr}` : ""}`,
    );
    return null;
  }

  if (iconBytes) {
    try {
      writeFileSync(paths.iconPath, iconBytes);
      log("INFO", `installed AppIcon.icns (${iconBytes.length} bytes) → ${paths.iconPath}`);
    } catch (e) {
      log("WARN", `failed to install AppIcon.icns: ${(e as Error).message}`);
      // Non-fatal: notifications still work with the default icon.
    }
  } else {
    log("WARN", `skipped AppIcon install: no bundled icon was readable`);
  }

  const signResult = runSync(
    ["/usr/bin/codesign", "--force", "--deep", "--sign", "-", paths.appDir],
    {
      timeoutMs: 30000,
    },
  );
  if (signResult.error || signResult.exitCode !== 0) {
    log(
      "WARN",
      `codesign notify-helper failed: ${signResult.error?.message ?? `exit ${signResult.exitCode}`}`,
    );
  }

  // Nudge LaunchServices so the icon cache picks up the (re)installed bundle.
  // Best-effort: notifications still work if this fails (the icon just won't
  // refresh until macOS re-reads the bundle on its own).
  const LSREGISTER =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (existsSync(LSREGISTER)) {
    const reg = runSync([LSREGISTER, "-f", paths.appDir], { timeoutMs: 15000 });
    if (reg.exitCode !== 0) {
      log("WARN", `lsregister failed (exit ${reg.exitCode}): ${reg.stderr.trim()}`);
    }
  }

  writeFileSync(paths.hashPath, sourceHash, "utf8");
  return paths.appDir;
}

export interface TerminalNotifierOptions {
  /**
   * Absolute path to a shell script the helper should exec via iTerm when
   * the user clicks the notification, instead of `tmux attach`. Used by
   * lazy mode where tmux + agent haven't been started yet.
   */
  launchScriptPath?: string;
  /** Human-readable agent name shown in the notification title. */
  agentName: string;
  /** When true, the notification announces a click-to-start session. */
  lazy: boolean;
  /** Optional one-line subtitle describing what the agent is going to work on. */
  context?: string;
}

/**
 * Launch a Swift(UserNotifications) helper that posts a clickable notification
 * and handles the click callback in-process.
 */
export function terminalNotifier(
  session: string,
  log: Logger,
  options: TerminalNotifierOptions,
): boolean {
  const helperApp = ensureNotificationHelper(log);
  if (!helperApp) return false;

  const tmuxPath = whichSync("tmux") ?? "/opt/homebrew/bin/tmux";
  const args = [
    "/usr/bin/open",
    "-g",
    "-n",
    "-a",
    helperApp,
    "--args",
    "--session",
    session,
    "--tmux-path",
    tmuxPath,
    "--ttl-seconds",
    String(HELPER_TTL_SECONDS),
    "--agent-name",
    options.agentName,
  ];
  if (options.lazy) args.push("--lazy");
  if (options.launchScriptPath) {
    args.push("--launch-script", options.launchScriptPath);
  }
  if (options.context) {
    args.push("--context", options.context);
  }

  log("INFO", `notify-helper: ${args.map(shellQuote).join(" ")}`);
  const r = runDetached(args);
  if (!r.ok) {
    log("WARN", `failed to launch notify-helper: ${r.error?.message ?? "unknown error"}`);
    return false;
  }
  log("INFO", `notify-helper launched: pid=${r.pid ?? -1}`);
  return true;
}
