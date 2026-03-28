#!/usr/bin/env node
/**
 * @rhost/view — run commands against a RhostMUSH server
 *
 * REPL mode (no command given — keeps container alive for interactive use):
 *   npx @rhost/view
 *   npx @rhost/view --softcode RockJobs.fixed.mush --softcode help.mush
 *   npx @rhost/view --watch --softcode MyGame.mush   (auto-reload on file save)
 *
 * One-shot mode (runs a single command and exits):
 *   npx @rhost/view "+jobs/help"
 *   npx @rhost/view --softcode RockJobs.fixed.mush "+jobs/help"
 *
 * Pipe / stdin mode (commands piped from stdin):
 *   echo "+jobs/help" | npx @rhost/view
 *   cat commands.txt  | npx @rhost/view --softcode MyGame.mush
 *
 * Config mode (connect to an existing server instead of Docker):
 *   npx @rhost/view --config mush.config.json
 *   npx @rhost/view --config mush.config.json "+jobs/help"
 *
 * Inline connection (no config file required):
 *   npx @rhost/view --host localhost --port 4201 --user Wizard --pass secret "+cmd"
 *
 * Session logging:
 *   npx @rhost/view --output session.log
 *
 * REPL dot-commands:
 *   .load <file>    install a softcode file mid-session
 *   .reload         reinstall all startup softcode files
 *   .list           show currently loaded softcode files
 *   .save <file>    save session output to a file
 *   .help           show available dot-commands
 *   .exit           shut down
 */

import { createInterface } from "readline";
import type { Interface as ReadlineInterface } from "readline";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  createWriteStream,
  watch as fsWatch,
} from "fs";
import type { WriteStream } from "fs";
import { resolve, basename, join } from "path";
import { homedir } from "os";
import { RhostClient, RhostContainer } from "@rhost/testkit";
import {
  validateSoftcodePath,
  validateConfigPath,
  validateWritePath,
  validateConfig,
  validateInlineCreds,
  extractHistoryLines,
  redactPassArg,
  safeErrorMessage,
} from "./validate";

// ---------------------------------------------------------------------------
// Version (read from package.json at runtime)
// ---------------------------------------------------------------------------

let VERSION = "unknown";
try {
  VERSION = JSON.parse(
    readFileSync(join(__dirname, "../package.json"), "utf8")
  ).version as string;
} catch {
  // non-fatal
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

let configPath: string | undefined;
let inlineHost: string | undefined;
let inlinePort: number | undefined;
let inlineUser: string | undefined;
let inlinePass: string | undefined;
let cmd: string | undefined;
let outputFile: string | undefined;
let paceMs = 50;
let settleMs = 150;
let quiet = false;
let watchMode = false;
const softcodeFiles: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--version" || arg === "-V") {
    console.log(`@rhost/view ${VERSION}`);
    process.exit(0);
  }

  if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  }

  if (arg === "--config") {
    configPath = args[++i];
    validateConfigPath(configPath);
  } else if (arg === "--softcode") {
    const f = args[++i];
    validateSoftcodePath(f);
    softcodeFiles.push(f);
  } else if (arg === "--host") {
    inlineHost = args[++i];
  } else if (arg === "--port") {
    const raw = args[++i];
    inlinePort = parseInt(raw, 10);
    if (isNaN(inlinePort) || inlinePort < 1 || inlinePort > 65535) {
      console.error("Error: --port must be an integer between 1 and 65535");
      process.exit(1);
    }
  } else if (arg === "--user") {
    inlineUser = args[++i];
  } else if (arg === "--pass") {
    inlinePass = args[++i];
  } else if (arg === "--output") {
    outputFile = args[++i];
    validateWritePath(outputFile);
  } else if (arg === "--pace") {
    const raw = args[++i];
    paceMs = parseInt(raw, 10);
    if (isNaN(paceMs) || paceMs < 0) {
      console.error("Error: --pace must be a non-negative integer");
      process.exit(1);
    }
  } else if (arg === "--settle") {
    const raw = args[++i];
    settleMs = parseInt(raw, 10);
    if (isNaN(settleMs) || settleMs < 0) {
      console.error("Error: --settle must be a non-negative integer");
      process.exit(1);
    }
  } else if (arg === "--quiet" || arg === "-q") {
    quiet = true;
  } else if (arg === "--watch" || arg === "-w") {
    watchMode = true;
  } else if (!arg.startsWith("-")) {
    cmd = arg;
  }
}

// Redact --pass from process.argv immediately after parsing to limit the
// window during which the credential is visible in `ps aux` / /proc/cmdline.
redactPassArg(process.argv);

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
@rhost/view ${VERSION}

Run commands against a RhostMUSH server (Docker or existing).

USAGE
  mush-view [options] [command]

OPTIONS
  --softcode <file>    Load a .mush file before running (repeatable)
  --config <file>      Connect to an existing server via JSON config
  --host <host>        Server hostname (inline connection)
  --port <port>        Server port   (inline connection, default: 4201)
  --user <name>        Username      (inline connection)
  --pass <pass>        Password      (inline connection)
  --output <file>      Tee all session output to a file
  --pace <ms>          Delay between softcode lines (default: 50)
  --settle <ms>        Wait after each command for output (default: 150)
  --watch, -w          Auto-reload softcode files when they change (REPL only)
  --quiet, -q          Suppress installation progress messages
  --version, -V        Print version and exit
  --help, -h           Show this help

REPL DOT-COMMANDS
  .load <file>         Install a softcode file
  .reload              Reinstall all startup softcode files
  .list                Show currently loaded softcode files
  .save <file>         Save session output to a file
  .help                Show dot-commands
  .exit                Shut down

EXAMPLES
  npx @rhost/view "+jobs/help"
  npx @rhost/view --softcode MyGame.mush --watch
  npx @rhost/view --config mush.config.json "+help me"
  npx @rhost/view --host localhost --port 4201 --user Wizard --pass secret "+cmd"
  echo "+help me" | npx @rhost/view --config mush.config.json
  npx @rhost/view --output session.log
`);
}

// ---------------------------------------------------------------------------
// Output: tee to file + session buffer (for .save)
// ---------------------------------------------------------------------------

let logStream: WriteStream | undefined;
if (outputFile) {
  logStream = createWriteStream(resolve(outputFile), { flags: "a" });
}

const sessionLog: string[] = [];

function log(message: string): void {
  console.log(message);
  logStream?.write(message + "\n");
  sessionLog.push(message);
}

function logError(message: string): void {
  console.error(message);
  logStream?.write(message + "\n");
  sessionLog.push(message);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSoftcode(file: string): string[] {
  return readFileSync(resolve(file), "utf8")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith("@@"));
}

async function installFile(client: RhostClient, file: string): Promise<void> {
  if (!quiet) process.stdout.write(`Installing ${file}...`);
  for (const line of loadSoftcode(file)) {
    await client.command(line);
  }
  if (!quiet) {
    process.stdout.write(" done.\n");
  }
}

function getClient(host: string, port: number): RhostClient {
  return new RhostClient({
    host,
    port,
    stripAnsi: false,
    paceMs,
    commandSettleMs: settleMs,
  });
}

// ---------------------------------------------------------------------------
// Watch mode helpers
// ---------------------------------------------------------------------------

const pendingReloads = new Map<string, ReturnType<typeof setTimeout>>();

function setupWatch(
  file: string,
  client: RhostClient,
  rl: ReadlineInterface
): void {
  fsWatch(resolve(file), () => {
    // Debounce — editors often emit multiple events on a single save
    const existing = pendingReloads.get(file);
    if (existing) clearTimeout(existing);
    pendingReloads.set(
      file,
      setTimeout(async () => {
        pendingReloads.delete(file);
        log(`\n[watch] ${basename(file)} changed — reloading...`);
        try {
          await installFile(client, file);
        } catch (e: unknown) {
          logError(`Error: ${safeErrorMessage(e)}`);
        }
        rl.prompt();
      }, 200)
    );
  });
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

const HISTORY_FILE = join(homedir(), ".mush_history");

async function runRepl(client: RhostClient): Promise<void> {
  // Load persisted history (file is oldest-first; readline wants newest-first)
  const history = existsSync(HISTORY_FILE)
    ? readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean).reverse()
    : [];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "mush> ",
    history,
    historySize: 1000,
  });

  // Set up file watchers now that we have a readline instance
  if (watchMode) {
    for (const file of softcodeFiles) {
      setupWatch(file, client, rl);
    }
  }

  rl.prompt();

  rl.on("line", async (line) => {
    line = line.trim();

    if (!line) {
      rl.prompt();
      return;
    }

    // Pause input while processing so buffered lines don't interleave output
    rl.pause();

    // --- dot-commands ---

    if (line === ".exit") {
      rl.close();
      return;
    }

    if (line === ".help") {
      log(
        [
          "",
          "  .load <file>    install a softcode file",
          "  .reload         reinstall all startup softcode files",
          "  .list           show currently loaded softcode files",
          "  .save <file>    save session output to a file",
          "  .help           show this message",
          "  .exit           shut down",
          "",
        ].join("\n")
      );
      rl.resume();
      rl.prompt();
      return;
    }

    if (line === ".reload") {
      if (softcodeFiles.length === 0) {
        log("No startup softcode files to reload.");
      } else {
        for (const file of softcodeFiles) {
          try {
            await installFile(client, file);
          } catch (e: unknown) {
            logError(`Error: ${safeErrorMessage(e)}`);
          }
        }
      }
      rl.resume();
      rl.prompt();
      return;
    }

    if (line === ".list") {
      if (softcodeFiles.length === 0) {
        log("No softcode files loaded.");
      } else {
        log("\nLoaded softcode files:");
        softcodeFiles.forEach((f, idx) => log(`  ${idx + 1}. ${f}`));
        log("");
      }
      rl.resume();
      rl.prompt();
      return;
    }

    if (line.startsWith(".save ")) {
      const file = line.slice(6).trim();
      if (!file) {
        logError("Usage: .save <filename>");
        rl.resume();
        rl.prompt();
        return;
      }
      try {
        validateWritePath(file);
        writeFileSync(resolve(file), sessionLog.join("\n") + "\n", "utf8");
        log(`Session saved to ${file}`);
      } catch (e: unknown) {
        logError(`Error saving: ${safeErrorMessage(e)}`);
      }
      rl.resume();
      rl.prompt();
      return;
    }

    if (line.startsWith(".load ")) {
      const file = line.slice(6).trim();
      try {
        validateSoftcodePath(file);
        await installFile(client, file);
        // Track for .reload and --watch
        if (!softcodeFiles.includes(file)) {
          softcodeFiles.push(file);
          if (watchMode) setupWatch(file, client, rl);
        }
      } catch (e: unknown) {
        logError(`Error: ${safeErrorMessage(e)}`);
      }
      rl.resume();
      rl.prompt();
      return;
    }

    // --- regular MUSH command ---
    try {
      const output = await client.command(line);
      if (output.length) log(output.join("\n"));
    } catch (e: unknown) {
      logError(`Error: ${safeErrorMessage(e)}`);
    }

    rl.resume();
    rl.prompt();
  });

  return new Promise((res) => {
    rl.on("close", () => {
      // Persist history (newest-first in memory → oldest-first on disk).
      // extractHistoryLines guards against the undocumented internal property
      // being absent or non-array in future Node versions.
      const lines = extractHistoryLines(rl);
      if (lines.length > 0) {
        try {
          writeFileSync(
            HISTORY_FILE,
            [...lines].reverse().join("\n") + "\n",
            "utf8"
          );
        } catch {
          // non-fatal — don't break teardown over a history write failure
        }
      }
      res();
    });
  });
}

// ---------------------------------------------------------------------------
// Stdin / pipe mode
// ---------------------------------------------------------------------------

async function runStdin(client: RhostClient): Promise<void> {
  const rl = createInterface({ input: process.stdin });

  rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    rl.pause();
    try {
      const output = await client.command(line);
      if (output.length) log(output.join("\n"));
    } catch (e: unknown) {
      logError(`Error: ${safeErrorMessage(e)}`);
    }
    rl.resume();
  });

  return new Promise((res) => rl.on("close", res));
}

// ---------------------------------------------------------------------------
// Boot: connect + authenticate
// ---------------------------------------------------------------------------

async function boot(): Promise<{
  client: RhostClient;
  teardown: () => Promise<void>;
}> {
  // Config-file mode
  if (configPath) {
    const config = validateConfig(
      JSON.parse(readFileSync(resolve(configPath), "utf8"))
    );
    const client = getClient(config.host, config.port);
    await client.connect();
    await client.login(config.username, config.password);
    return { client, teardown: () => client.disconnect() };
  }

  // Inline connection mode
  if (inlineHost) {
    const port = inlinePort ?? 4201;
    const user = inlineUser ?? process.env.MUSH_USER ?? "Wizard";
    const pass = inlinePass ?? process.env.MUSH_PASS;
    validateInlineCreds(user, pass);
    const client = getClient(inlineHost, port);
    await client.connect();
    await client.login(user, pass!);
    return { client, teardown: () => client.disconnect() };
  }

  // Docker mode (default)
  const container = RhostContainer.fromImage(
    process.env.MUSH_IMAGE ?? "rhostmush:latest"
  );
  if (!quiet) process.stdout.write("Starting RhostMUSH container...");
  const { host, port } = await container.start();
  if (!quiet) console.log(" ready.");

  const client = getClient(host, port);
  await client.connect();
  await client.login(
    process.env.MUSH_USER ?? "Wizard",
    process.env.MUSH_PASS ?? "Nyctasia"
  );

  return {
    client,
    teardown: async () => {
      await client.disconnect();
      await container.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  const { client, teardown } = await boot();

  try {
    // Drain post-login server output (room look, connect messages, etc.) that
    // accumulated in the receive buffer between login() completing and our first
    // real command.  Without this, the buffered lines appear as output of the
    // first command sent — making it look like the REPL's first response is delayed.
    const loginOutput = await client.command("");
    if (loginOutput.length) log(loginOutput.join("\n"));

    for (const file of softcodeFiles) {
      await installFile(client, file);
    }

    if (cmd) {
      // One-shot mode
      const output = await client.command(cmd);
      log(output.join("\n"));
    } else if (!process.stdin.isTTY) {
      // Pipe / stdin mode
      await runStdin(client);
    } else {
      // Interactive REPL
      await runRepl(client);
    }
  } finally {
    await teardown();
    logStream?.end();
  }
})();
