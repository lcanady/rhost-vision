import { describe, it, expect } from "vitest";
import {
  validateSoftcodePath,
  validateConfigPath,
  validateConfig,
  validateWritePath,
  redactPassArg,
  safeErrorMessage,
  validateInlineCreds,
  extractHistoryLines,
} from "../validate.js";

// ---------------------------------------------------------------------------
// H1 — Path Traversal: softcode files
// ---------------------------------------------------------------------------

describe("validateSoftcodePath — H1 path traversal", () => {
  it("allows a normal .mush file", () => {
    expect(() => validateSoftcodePath("RockJobs.fixed.mush")).not.toThrow();
  });

  it("allows a .mush file with a relative path", () => {
    expect(() => validateSoftcodePath("./softcode/help.mush")).not.toThrow();
  });

  it("EXPLOIT: rejects /etc/passwd (no .mush extension)", () => {
    expect(() => validateSoftcodePath("/etc/passwd")).toThrow(
      ".mush extension"
    );
  });

  it("EXPLOIT: rejects /etc/shadow", () => {
    expect(() => validateSoftcodePath("/etc/shadow")).toThrow(".mush extension");
  });

  it("EXPLOIT: rejects a traversal disguised without extension", () => {
    expect(() => validateSoftcodePath("../../secrets")).toThrow(
      ".mush extension"
    );
  });

  it("EXPLOIT: rejects a .json file passed as softcode", () => {
    expect(() => validateSoftcodePath("mush.config.json")).toThrow(
      ".mush extension"
    );
  });
});

// ---------------------------------------------------------------------------
// H1 — Path Traversal: config files
// ---------------------------------------------------------------------------

describe("validateConfigPath — H1 path traversal", () => {
  it("allows a normal .json file", () => {
    expect(() => validateConfigPath("mush.config.json")).not.toThrow();
  });

  it("EXPLOIT: rejects /etc/passwd as config", () => {
    expect(() => validateConfigPath("/etc/passwd")).toThrow(".json extension");
  });

  it("EXPLOIT: rejects a .mush file passed as config", () => {
    expect(() => validateConfigPath("game.mush")).toThrow(".json extension");
  });
});

// ---------------------------------------------------------------------------
// M2 — Config validation
// ---------------------------------------------------------------------------

describe("validateConfig — M2 missing/malformed fields", () => {
  const valid = {
    host: "localhost",
    port: 4201,
    username: "Wizard",
    password: "secret",
  };

  it("accepts a well-formed config", () => {
    expect(validateConfig(valid)).toEqual(valid);
  });

  it("rejects null", () => {
    expect(() => validateConfig(null)).toThrow("JSON object");
  });

  it("rejects an array", () => {
    expect(() => validateConfig([])).toThrow("JSON object");
  });

  it("rejects missing host", () => {
    expect(() => validateConfig({ ...valid, host: undefined })).toThrow("host");
  });

  it("rejects empty host", () => {
    expect(() => validateConfig({ ...valid, host: "  " })).toThrow("host");
  });

  it("rejects string port", () => {
    expect(() => validateConfig({ ...valid, port: "4201" })).toThrow("port");
  });

  it("rejects port 0", () => {
    expect(() => validateConfig({ ...valid, port: 0 })).toThrow("port");
  });

  it("rejects port 99999", () => {
    expect(() => validateConfig({ ...valid, port: 99999 })).toThrow("port");
  });

  it("rejects float port", () => {
    expect(() => validateConfig({ ...valid, port: 42.5 })).toThrow("port");
  });

  it("rejects missing username", () => {
    expect(() => validateConfig({ ...valid, username: "" })).toThrow(
      "username"
    );
  });

  it("rejects missing password", () => {
    expect(() => validateConfig({ ...valid, password: undefined })).toThrow(
      "password"
    );
  });
});

// ---------------------------------------------------------------------------
// L1 — ENOENT path disclosure
// ---------------------------------------------------------------------------

describe("safeErrorMessage — L1 path disclosure", () => {
  it("returns message for generic errors", () => {
    expect(safeErrorMessage(new Error("something went wrong"))).toBe(
      "something went wrong"
    );
  });

  it("EXPLOIT: strips full path from ENOENT — does not expose /etc/shadow", () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open '/etc/shadow'"), {
      code: "ENOENT",
      path: "/etc/shadow",
    });
    const msg = safeErrorMessage(err);
    expect(msg).not.toContain("/etc/shadow");
    expect(msg).toContain("shadow");   // basename is fine
    expect(msg).toMatch(/File not found/);
  });

  it("handles ENOENT with no path property", () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const msg = safeErrorMessage(err);
    expect(msg).toMatch(/File not found/);
  });

  it("handles non-Error thrown values", () => {
    expect(safeErrorMessage("oops")).toBe("oops");
    expect(safeErrorMessage(42)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// M1 — Path traversal bypass: .mush-suffixed traversal paths
// ---------------------------------------------------------------------------

describe("validateSoftcodePath — M1 dotted-extension traversal bypass", () => {
  it("EXPLOIT: rejects ../../etc/passwd.mush (.mush-suffixed traversal)", () => {
    expect(() => validateSoftcodePath("../../etc/passwd.mush")).toThrow("'..'");
  });

  it("EXPLOIT: rejects ../.ssh/id_rsa.mush", () => {
    expect(() => validateSoftcodePath("../.ssh/id_rsa.mush")).toThrow("'..'");
  });

  it("EXPLOIT: rejects ../secrets.mush (single step up)", () => {
    expect(() => validateSoftcodePath("../secrets.mush")).toThrow("'..'");
  });

  it("still allows a simple relative path (./softcode/help.mush)", () => {
    expect(() => validateSoftcodePath("./softcode/help.mush")).not.toThrow();
  });

  it("still allows a flat filename (MyGame.mush)", () => {
    expect(() => validateSoftcodePath("MyGame.mush")).not.toThrow();
  });

  it("still allows an absolute path (/home/user/game.mush)", () => {
    expect(() => validateSoftcodePath("/home/user/game.mush")).not.toThrow();
  });
});

describe("validateConfigPath — M1 dotted-extension traversal bypass", () => {
  it("EXPLOIT: rejects ../../secrets/creds.json (.json-suffixed traversal)", () => {
    expect(() => validateConfigPath("../../secrets/creds.json")).toThrow("'..'");
  });

  it("EXPLOIT: rejects ../mush.config.json (single step up)", () => {
    expect(() => validateConfigPath("../mush.config.json")).toThrow("'..'");
  });

  it("still allows mush.config.json (flat filename)", () => {
    expect(() => validateConfigPath("mush.config.json")).not.toThrow();
  });

  it("still allows an absolute path (/etc/mush/config.json)", () => {
    expect(() => validateConfigPath("/etc/mush/config.json")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M2/M3 — Unvalidated write paths (.save and --output)
// ---------------------------------------------------------------------------

describe("validateWritePath — M2/M3 arbitrary file write", () => {
  it("EXPLOIT: rejects ../../.ssh/authorized_keys", () => {
    expect(() => validateWritePath("../../.ssh/authorized_keys")).toThrow("'..'");
  });

  it("EXPLOIT: rejects ../crontab (single step up)", () => {
    expect(() => validateWritePath("../crontab")).toThrow("'..'");
  });

  it("EXPLOIT: rejects traversal path to system file", () => {
    expect(() => validateWritePath("../../etc/crontab")).toThrow("'..'");
  });

  it("allows a flat filename (session.log)", () => {
    expect(() => validateWritePath("session.log")).not.toThrow();
  });

  it("allows a subdirectory path (logs/session.log)", () => {
    expect(() => validateWritePath("logs/session.log")).not.toThrow();
  });

  it("allows an absolute path (/tmp/session.log)", () => {
    expect(() => validateWritePath("/tmp/session.log")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M-1 — Hardcoded default password in inline connection mode
// ---------------------------------------------------------------------------

describe("validateInlineCreds — M-1 silent default password", () => {
  it("EXPLOIT: without guard, omitting --pass silently resolves to 'Nyctasia'", () => {
    // This documents the pre-fix behaviour: the ?? chain hides the fallback.
    const inlinePass: string | undefined = undefined;
    const envPass: string | undefined = undefined;
    const resolved = inlinePass ?? envPass ?? "Nyctasia";
    expect(resolved).toBe("Nyctasia"); // proves the bug exists without the guard
  });

  it("throws when --pass and MUSH_PASS are both absent (inline mode)", () => {
    expect(() => validateInlineCreds("Wizard", undefined)).toThrow(/--pass/);
  });

  it("accepts an explicit --pass value", () => {
    expect(() => validateInlineCreds("Wizard", "mySecret")).not.toThrow();
  });

  it("accepts a password supplied via the env-var path (non-empty string)", () => {
    expect(() => validateInlineCreds("Wizard", "envSecret")).not.toThrow();
  });

  it("throws when the resolved password is an empty string", () => {
    expect(() => validateInlineCreds("Wizard", "")).toThrow(/--pass/);
  });
});

// ---------------------------------------------------------------------------
// L1 — Credential exposure: --pass in process.argv
// ---------------------------------------------------------------------------

describe("redactPassArg — L1 password in process list", () => {
  it("EXPLOIT: without redaction, --pass value is readable from argv", () => {
    const argv = ["node", "cli.js", "--pass", "s3cr3t", "+cmd"];
    // Before fix: password is visible
    expect(argv).toContain("s3cr3t");
  });

  it("redacts --pass value so it no longer appears in argv", () => {
    const argv = ["node", "cli.js", "--host", "localhost", "--pass", "s3cr3t", "+cmd"];
    redactPassArg(argv);
    expect(argv).not.toContain("s3cr3t");
    expect(argv[argv.indexOf("--pass") + 1]).toBe("***");
  });

  it("is a no-op when --pass is absent", () => {
    const argv = ["node", "cli.js", "--host", "localhost", "+cmd"];
    expect(() => redactPassArg(argv)).not.toThrow();
    expect(argv).not.toContain("***");
  });

  it("is safe when --pass is the last token with no following value", () => {
    const argv = ["node", "cli.js", "--pass"];
    expect(() => redactPassArg(argv)).not.toThrow();
    expect(argv).toEqual(["node", "cli.js", "--pass"]);
  });
});

// ---------------------------------------------------------------------------
// L-1 — Unsafe readline.history internal cast
// ---------------------------------------------------------------------------

describe("extractHistoryLines — L-1 readline internal property safety", () => {
  it("EXPLOIT: casting an object with no history property gives undefined, spread would throw", () => {
    // This demonstrates the pre-fix risk: if `history` is undefined at runtime,
    // `[...undefined]` throws a TypeError.
    const fakeRl = {} as unknown as { history: string[] };
    const lines = fakeRl.history; // undefined
    expect(() => [...(lines as unknown as string[])]).toThrow();
  });

  it("returns an empty array when the rl object has no history property", () => {
    expect(extractHistoryLines({})).toEqual([]);
  });

  it("returns an empty array when history is undefined", () => {
    expect(extractHistoryLines({ history: undefined })).toEqual([]);
  });

  it("returns an empty array when history is null", () => {
    expect(extractHistoryLines({ history: null })).toEqual([]);
  });

  it("returns an empty array when history is a non-array truthy value", () => {
    expect(extractHistoryLines({ history: "oops" })).toEqual([]);
    expect(extractHistoryLines({ history: 42 })).toEqual([]);
  });

  it("returns the history array when it is a valid string[]", () => {
    const lines = ["look here", "score", "+jobs/view 1"];
    expect(extractHistoryLines({ history: lines })).toEqual(lines);
  });

  it("returns an empty array when history is an empty array", () => {
    expect(extractHistoryLines({ history: [] })).toEqual([]);
  });
});
