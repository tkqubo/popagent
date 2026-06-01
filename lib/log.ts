/**
 * 共通ロガー。各ツール側で `makeLogger("tool-name")` してから使う。
 */

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type Logger = (level: LogLevel, msg: string, ...rest: unknown[]) => void;

export function makeLogger(tag: string): Logger {
  return (level, msg, ...rest) => {
    const ts = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\..*Z$/, "");
    const formatted =
      rest.length > 0
        ? `${msg} ${rest.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ")}`
        : msg;
    console.log(`${ts} [${level}] ${tag}: ${formatted}`);
  };
}
