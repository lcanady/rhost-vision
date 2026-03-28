# @rhost/vision

Run commands against a RhostMUSH server and print the output. Works in three modes: **Docker** (spins up a fresh RhostMUSH container), **Config** (connects via a JSON credentials file), or **Inline** (passes credentials directly as flags).

Designed to be shared across multiple MUSHcode projects so you don't need to copy a runner script into every repo.

---

## Table of Contents

- [Quick Start with npx](#quick-start-with-npx)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
  - [Docker Mode (default)](#docker-mode-default)
  - [Config Mode](#config-mode)
  - [Inline Connection Mode](#inline-connection-mode)
  - [Installing Softcode Before Running](#installing-softcode-before-running)
  - [Watch Mode](#watch-mode)
  - [Pipe / Stdin Mode](#pipe--stdin-mode)
  - [Session Logging](#session-logging)
- [REPL Dot-Commands](#repl-dot-commands)
- [All Flags](#all-flags)
- [Environment Variables](#environment-variables)
- [Config File Reference](#config-file-reference)
- [Softcode File Format](#softcode-file-format)
- [REPL History](#repl-history)
- [Using in a Project](#using-in-a-project)
- [How It Works](#how-it-works)
- [Security](#security)
- [Building from Source](#building-from-source)
  - [Available Scripts](#available-scripts)
- [Troubleshooting](#troubleshooting)

---

## Quick Start with npx

No install needed. As long as you have Node and Docker running:

```bash
# Run any MUSH command against a fresh RhostMUSH container
npx @rhost/vision "+help me"

# Load softcode first, then run the command
npx @rhost/vision --softcode MyGame.mush "+mycommand"

# Interactive REPL with auto-reload on file save
npx @rhost/vision --softcode MyGame.mush --watch

# Connect to an existing server
npx @rhost/vision --config mush.config.json "+help me"

# Connect inline without a config file
npx @rhost/vision --host localhost --port 4201 --user Wizard --pass secret "+cmd"

# Pipe commands from a file
cat commands.txt | npx @rhost/vision --config mush.config.json
```

npx always pulls the latest published version. To pin to a specific version:

```bash
npx @rhost/vision@0.1.0 "+help me"
```

---

## Features

- **Zero-config Docker mode** — no running server needed; pulls the official RhostMUSH image automatically
- **Config mode** — connect to any existing MUSH server with a JSON file
- **Inline connection** — pass `--host`/`--port`/`--user`/`--pass` directly without a config file
- **Repeatable `--softcode` flag** — load as many `.mush` files as you need, in order
- **Watch mode (`--watch`)** — auto-reloads softcode files when they change on disk
- **Pipe / stdin mode** — pipe commands in from a file or another process
- **Session logging (`--output`)** — tee all output to a file while also printing to the terminal
- **REPL history** — command history persisted to `~/.mush_history` across sessions
- **Quiet mode (`--quiet`)** — suppress installation progress messages for clean script output
- **Tunable timing** — `--pace` and `--settle` let you adjust command timing for slow or fast servers
- **Security hardening** — path traversal protection on all file args, password redaction from process list, safe error messages, strict config validation
- **npx-friendly** — works without a global install

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 18 | ESM support required |
| Docker | any recent | Only needed for Docker mode |
| npm | ≥ 9 | Provides npx |

Docker must be running if you use the default Docker mode. Config and inline modes have no Docker dependency.

---

## Installation

### One-off with npx (no install required)

```bash
npx @rhost/vision "+help me"
```

### As a project dependency

```bash
npm install @rhost/vision
```

This installs the `mush-vision` binary into your project's `node_modules/.bin`, available in npm scripts.

### Global install

```bash
npm install -g @rhost/vision
mush-vision "+help me"
```

---

## Usage

```
mush-vision [options] [command]
```

### Docker Mode (default)

When no connection flags are given, starts a RhostMUSH Docker container, runs your command, and stops the container when done.

```bash
npx @rhost/vision "+jobs/help"
```

```
Starting RhostMUSH container... ready.
<output of your command here>
```

The container is always stopped cleanly, even if the command throws an error.

### Config Mode

Connect to an existing MUSH server via a JSON credentials file:

```bash
npx @rhost/vision --config mush.config.json "+jobs/help"
```

See [Config File Reference](#config-file-reference) for the file format.

### Inline Connection Mode

Pass connection details directly without a config file — useful for CI scripts and one-liners:

```bash
npx @rhost/vision --host localhost --port 4201 --user Wizard --pass secret "+jobs/help"
```

`--port` defaults to `4201`. `--user` falls back to `MUSH_USER` then `Wizard`. `--pass` falls back to `MUSH_PASS` — **if neither is supplied the tool exits with an error** rather than silently using a default password.

### Installing Softcode Before Running

Use `--softcode` (repeatable) to load `.mush` files before your command runs. Files are installed in the order specified.

```bash
npx @rhost/vision \
  --softcode RockJobs.fixed.mush \
  --softcode help.mush \
  --softcode security.mush \
  "+jobs/help"
```

```
Starting RhostMUSH container... ready.
Installing RockJobs.fixed.mush... done.
Installing help.mush... done.
Installing security.mush... done.
<output of your command>
```

Add `--quiet` to suppress the installation lines.

### Watch Mode

Use `--watch` (or `-w`) in REPL mode to automatically reload softcode files whenever they change on disk:

```bash
npx @rhost/vision --softcode MyGame.mush --watch
```

Edit `MyGame.mush` and save — the tool detects the change and reinstalls immediately:

```
mush> [watch] MyGame.mush changed — reloading...
Installing MyGame.mush... done.
mush>
```

Files loaded mid-session with `.load` are also watched. Watch mode has no effect in one-shot or pipe mode.

### Pipe / Stdin Mode

When stdin is not a TTY (i.e. data is being piped in), the tool reads commands line-by-line and exits when stdin closes:

```bash
echo "+jobs/help" | npx @rhost/vision --config mush.config.json

cat commands.txt | npx @rhost/vision --softcode MyGame.mush --config mush.config.json
```

This is useful for batch testing without a `.mush` file, or for scripted automation.

### Session Logging

Use `--output <file>` to tee all output to a file while still printing to the terminal:

```bash
npx @rhost/vision --softcode MyGame.mush --output session.log
```

Output is appended to the file, so multiple sessions accumulate in a single log. Combine with `--quiet` to keep the file clean of installation noise.

---

## REPL Dot-Commands

When running interactively (no command argument), these special commands are available at the `mush>` prompt:

| Command | Description |
|---------|-------------|
| `.load <file>` | Install a softcode file. Also registers it for `.reload` and `--watch`. |
| `.reload` | Reinstall all startup softcode files in order |
| `.list` | Show all currently loaded softcode files |
| `.save <file>` | Save the session output buffer to a file |
| `.help` | Show available dot-commands |
| `.exit` | Disconnect and shut down |

---

## All Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--softcode <file>` | | Load a `.mush` file before running (repeatable) |
| `--config <file>` | | Connect to an existing server via JSON config |
| `--host <host>` | | Server hostname (inline connection) |
| `--port <port>` | | Server port (inline connection, default: `4201`) |
| `--user <name>` | | Username (inline connection) |
| `--pass <pass>` | | Password (inline connection) |
| `--output <file>` | | Tee all session output to a file (append mode) |
| `--pace <ms>` | | Delay between softcode lines in ms (default: `50`) |
| `--settle <ms>` | | Wait after each command for output in ms (default: `150`) |
| `--watch` | `-w` | Auto-reload softcode files when they change (REPL only) |
| `--quiet` | `-q` | Suppress installation progress messages |
| `--version` | `-V` | Print version and exit |
| `--help` | `-h` | Show help and exit |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MUSH_IMAGE` | `rhostmush:latest` | Docker image to use |
| `MUSH_USER` | `Wizard` | Login username (Docker and inline modes) |
| `MUSH_PASS` | `Nyctasia` *(Docker only)* | Login password. **Required** for inline mode — if absent, the tool exits with an error. Docker mode keeps `Nyctasia` as the well-known container default. |

Config mode credentials always come from the config file.

---

## Config File Reference

Create a `mush.config.json` in your project (keep it out of version control if it contains real credentials):

```json
{
  "host": "localhost",
  "port": 4201,
  "username": "Wizard",
  "password": "yourpassword"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `host` | string | Hostname or IP of the MUSH server |
| `port` | number | Port the MUSH listens on (RhostMUSH default: `4201`) |
| `username` | string | Character name to connect as |
| `password` | string | Character password |

Add to `.gitignore`:

```
mush.config.json
```

---

## Softcode File Format

Softcode files are plain text, one MUSH command per line.

- Lines beginning with `@@` are treated as comments and skipped
- Blank lines are skipped
- All other lines are sent to the server verbatim, in order

```
@@ This is a comment — it will be ignored
@create My Object=10
&MYATTR My Object=some value
@set My Object=INHERIT
```

---

## REPL History

The REPL saves command history to `~/.mush_history` when you exit. On the next session, history is restored so you can press the up arrow to recall previous commands.

Up to 1000 entries are kept. The history file is plain text, one command per line.

---

## Using in a Project

### Install as a dependency

```bash
npm install @rhost/vision
```

### Add a script to `package.json`

```json
{
  "scripts": {
    "mush": "mush-vision --softcode MyGame.mush --softcode help.mush",
    "mush:watch": "mush-vision --softcode MyGame.mush --watch"
  }
}
```

Then:

```bash
npm run mush "+mycommand"
npm run mush:watch           # interactive REPL with auto-reload
```

### Example: RockJobs project

```json
{
  "dependencies": {
    "@rhost/vision": "^0.1.0"
  },
  "scripts": {
    "mush": "mush-vision --softcode RockJobs.fixed.mush --softcode help.mush --softcode security.mush",
    "mush:watch": "mush-vision --softcode RockJobs.fixed.mush --softcode help.mush --softcode security.mush --watch"
  }
}
```

```bash
npm run mush "+jobs/help"
npm run mush:watch
```

---

## How It Works

### Docker Mode

1. `RhostContainer.fromImage()` (from `@rhost/testkit`) pulls the RhostMUSH Docker image if not cached and starts a container on a free port
2. `RhostClient` opens a TCP connection and logs in
3. Each `--softcode` file is read, stripped of comments and blank lines, and each line is sent with a configurable pace delay
4. The command runs and response lines are collected and printed
5. The client disconnects and the container stops — always, even on error, via a `finally` block

### Config / Inline Mode

1. `RhostClient` connects directly to the specified host/port
2. Logs in with the provided credentials
3. Runs the command, prints output, disconnects

### Watch Mode

`fs.watch` is registered on each softcode file path. Change events are debounced (200ms) to handle editors that write multiple events per save. The file is re-installed and the REPL prompt is restored.

### Pipe Mode

When `process.stdin.isTTY` is false (stdin is piped), the tool reads lines sequentially using `readline`, executes each as a MUSH command, and exits when stdin closes.

### Session Logging

`--output` opens a write stream in append mode. Every line printed by `log()` is written to both stdout and the file. Progress messages from softcode installation are not captured.

### Softcode Parsing

Lines are trimmed of trailing whitespace, blank lines filtered, `@@` comment lines filtered. Everything else is sent to the server as-is.

---

## Security

`@rhost/vision` validates all file paths and credentials before use. The security checks live in `src/validate.ts` and are enforced at startup.

### Path Traversal Protection

All file path arguments are checked for `..` traversal segments before any file is read or written.

- `--softcode <file>` — must have a `.mush` extension **and** must not contain `..`. A path like `../../etc/passwd.mush` is rejected even though it ends in `.mush`.
- `--config <file>` — must have a `.json` extension **and** must not contain `..`.
- `--output <file>` and `.save <file>` — must not contain `..`, preventing writes outside the current directory tree.

Absolute paths are accepted for all three; only relative traversal is blocked.

### Password Redaction

After argument parsing, the value following `--pass` is immediately overwritten with `***` in `process.argv`. This limits the window during which the credential is visible in `ps aux` and `/proc/<pid>/cmdline`.

Use `MUSH_PASS` (environment variable) instead of `--pass` on shared or multi-user systems for stronger protection — environment variables are not visible in the process list by default.

### Safe Error Messages

`ENOENT` ("file not found") errors only report the **basename** of the missing file, not the full path. This prevents the REPL from disclosing filesystem layout when a softcode or config file is not found.

```
Error: File not found: secrets.mush      ✓ (no path disclosed)
Error: ENOENT: /home/user/secrets.mush   ✗ (would leak path)
```

### Explicit Credentials Required for Inline Mode

When `--host` is used, a password must be supplied via `--pass` or `MUSH_PASS`. The tool **never silently falls back to a default password** for an existing server — doing so would silently authenticate against any server still running the well-known RhostMUSH default. If neither source provides a password, the tool exits immediately with a clear error:

```
Inline connection requires a password.
Supply --pass <password> or set the MUSH_PASS environment variable.
```

Docker mode is exempt: the container is ephemeral and its credentials are the well-known defaults by design.

### Config Validation

`--config` files are validated against a strict schema on load. Each field is checked for type and range before a connection is attempted, so misconfigurations fail fast with a clear message:

```
Config "port" must be an integer between 1 and 65535
Config missing required string field: "host"
```

---

## Building from Source

```bash
git clone <this repo>
cd mush-run
npm install
npm run build   # compiles src/cli.ts → dist/cli.js
```

To run without building (development):

```bash
npx tsx src/cli.ts "+help me"
```

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `dev` | `tsx src/cli.ts` | Run directly without compiling |
| `test` | `vitest run` | Run the test suite once |
| `test:watch` | `vitest` | Run tests in watch mode |

### Project structure

```
mush-run/
├── bin/
│   └── mush-run.js          # CLI entry shim
├── dist/                    # compiled output (git-ignored)
│   └── cli.js
├── src/
│   ├── cli.ts               # main logic: arg parsing, REPL, pipe mode, Docker/config/inline boot
│   ├── validate.ts          # path traversal checks, config schema validation,
│   │                        # password redaction, safe ENOENT messages
│   └── __tests__/
│       └── validate.test.ts # security-focused test suite (traversal, credential, disclosure)
├── package.json
└── tsconfig.json
```

---

## Troubleshooting

### `Cannot connect to the Docker daemon`

Docker is not running. Start Docker Desktop (Mac/Windows) or `sudo systemctl start docker` (Linux).

### Container starts but softcode install hangs

The server may need more time. Try increasing `--settle` to give the server longer to respond to each command:

```bash
npx @rhost/vision --settle 300 --softcode MyGame.mush "+cmd"
```

### Output is truncated or missing lines

The `--settle` window may be too short. Increase it. For very large softcode files, also try increasing `--pace`.

### `ECONNREFUSED` in config or inline mode

The MUSH server at the configured host/port isn't reachable. Check:
- The server is actually running
- The port matches (`4201` is the RhostMUSH default)
- No firewall is blocking the connection

### Softcode file not found

Paths are resolved relative to your **current working directory**, not the location of `@rhost/vision`. Run from the directory that contains your `.mush` files, or use absolute paths.

### Watch mode not triggering

Some editors write to a temp file then rename it, which `fs.watch` may not catch on all platforms. If reloads aren't triggering, save the file directly or use an editor that writes in-place.

### `.save` file is empty

Output from softcode installation (the `Installing ...` lines) is not captured in the session buffer — only MUSH server responses are. If you haven't run any commands yet, the buffer will be empty.
