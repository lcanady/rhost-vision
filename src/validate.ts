import { basename, normalize, sep } from "path";

export interface MushConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Returns true if the path contains any `..` traversal segment.
 * Works on both POSIX and Windows paths by splitting on both separators.
 */
function hasTraversal(file: string): boolean {
  return normalize(file).split(/[/\\]/).includes("..");
}

/**
 * Ensures softcode files have a .mush extension AND contain no `..` path
 * traversal segments. Blocks disguised reads like `../../secrets.mush`.
 */
export function validateSoftcodePath(file: string): void {
  if (!file.endsWith(".mush")) {
    throw new Error(
      `Softcode files must have a .mush extension (got: ${basename(file)})`
    );
  }
  if (hasTraversal(file)) {
    throw new Error(
      `Softcode file path must not contain '..' segments (use an absolute path instead)`
    );
  }
}

/**
 * Ensures config files have a .json extension AND contain no `..` path
 * traversal segments.
 */
export function validateConfigPath(file: string): void {
  if (!file.endsWith(".json")) {
    throw new Error(
      `Config files must have a .json extension (got: ${basename(file)})`
    );
  }
  if (hasTraversal(file)) {
    throw new Error(
      `Config file path must not contain '..' segments (use an absolute path instead)`
    );
  }
}

/**
 * Ensures a write-target path (--output, .save) contains no `..` traversal
 * segments, preventing arbitrary file overwrites outside the working directory.
 */
export function validateWritePath(file: string): void {
  if (hasTraversal(file)) {
    throw new Error(
      `Output path must not contain '..' segments (use an absolute path instead)`
    );
  }
}

/**
 * Redacts the value following --pass in the given argv array in-place.
 * Call immediately after argument parsing to limit the window during which
 * credentials are visible in /proc/<pid>/cmdline and `ps aux`.
 */
export function redactPassArg(argv: string[]): void {
  const idx = argv.indexOf("--pass");
  if (idx !== -1 && idx + 1 < argv.length) {
    argv[idx + 1] = "***";
  }
}

/**
 * Runtime-validates the shape and types of a parsed config object.
 * Throws a descriptive error rather than surfacing a cryptic TypeError later.
 */
export function validateConfig(raw: unknown): MushConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Config must be a JSON object.");
  }

  const c = raw as Record<string, unknown>;

  if (typeof c.host !== "string" || c.host.trim() === "") {
    throw new Error('Config missing required string field: "host"');
  }
  if (
    typeof c.port !== "number" ||
    !Number.isInteger(c.port) ||
    c.port < 1 ||
    c.port > 65535
  ) {
    throw new Error('Config "port" must be an integer between 1 and 65535');
  }
  if (typeof c.username !== "string" || c.username.trim() === "") {
    throw new Error('Config missing required string field: "username"');
  }
  if (typeof c.password !== "string") {
    throw new Error('Config missing required string field: "password"');
  }

  return {
    host: c.host,
    port: c.port,
    username: c.username,
    password: c.password,
  };
}

/**
 * Safely extracts the history string array from a readline Interface object.
 *
 * readline.Interface exposes `.history` as an undocumented internal property.
 * Its existence and type are not guaranteed across Node versions, so this
 * helper guards with Array.isArray rather than relying on the type cast alone.
 *
 * Returns an empty array if the property is absent, null, or not an array.
 */
export function extractHistoryLines(rl: unknown): string[] {
  const h = (rl as Record<string, unknown>)["history"];
  return Array.isArray(h) ? (h as string[]) : [];
}

/**
 * Validates that explicit credentials are present for an inline connection
 * (--host mode).  Throws if the password is absent or empty so the caller
 * never silently falls through to a well-known default like "Nyctasia".
 *
 * The username is allowed to default to "Wizard" (it is not a secret), but
 * the password MUST be supplied explicitly via --pass or MUSH_PASS.
 */
export function validateInlineCreds(
  user: string | undefined,
  pass: string | undefined
): void {
  if (!pass) {
    throw new Error(
      "Inline connection requires a password. " +
        "Supply --pass <password> or set the MUSH_PASS environment variable."
    );
  }
}

/**
 * Returns a safe error message that strips full filesystem paths from
 * ENOENT errors, preventing path disclosure in REPL output.
 */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return `File not found: ${basename(err.path ?? "")}`;
    }
    return e.message;
  }
  return String(e);
}
