import { describe, expect, it } from "vitest";
import { isArchivePath } from "./archive-path.js";

describe("a path in a backup's archive", () => {
  it.each([
    "engine.sqlite",
    "agent.sqlite",
    "config.json5",
    "manifest.json",
    "workspace/agent/notes.md",
    "workspace/agent/skills/\u7b14\u8bb0.md",
  ])("takes %s", (path) => {
    expect(isArchivePath(path)).toBe(true);
  });

  it.each([
    "keys/agent-key",
    "../engine.sqlite",
    "/etc/passwd",
    "workspace/../keys/agent-key",
    "workspace//notes.md",
    "workspace/./notes.md",
    "workspace/",
    "workspace/a\\b",
    "workspace/C:/notes.md",
    "workspace/a\u0000b",
    "logs/engine.log",
  ])("refuses %j", (path) => {
    expect(isArchivePath(path)).toBe(false);
  });
});
