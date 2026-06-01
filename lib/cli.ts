/**
 * citty does not validate unknown flags — `popagent watch --lasy` would silently
 * ignore the typo. These helpers add a strict check we can call from each
 * subcommand's `run`.
 */

type ArgDef = { type?: string; alias?: string | string[] };
export type ArgsDef = Record<string, ArgDef>;

/**
 * Return every long-form flag token in `rawArgs` that is not declared in
 * `argsDef`. Stops at `--` (POSIX end-of-options).
 *
 * Only long-form (`--name`) flags are checked. Short flags are constrained to
 * single characters in this CLI and hard to mistype unambiguously.
 */
export function findUnknownLongFlags(rawArgs: readonly string[], argsDef: ArgsDef): string[] {
  const known = new Set<string>(["help", "version"]);
  for (const name of Object.keys(argsDef)) known.add(name);

  const unknown: string[] = [];
  for (const arg of rawArgs) {
    if (arg === "--") break;
    if (!arg.startsWith("--")) continue;
    let name = arg.slice(2);
    const eq = name.indexOf("=");
    if (eq >= 0) name = name.slice(0, eq);
    // citty accepts `--no-<flag>` to negate booleans
    if (name.startsWith("no-") && known.has(name.slice(3))) continue;
    if (!known.has(name)) unknown.push(arg);
  }
  return unknown;
}
