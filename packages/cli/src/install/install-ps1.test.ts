// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads the two install scripts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// No PowerShell runs here; the nightly packed-install workflow runs this script on Windows. These
// checks hold the file's bytes and the values it shares with the macOS and Linux script.
const folder = join(import.meta.dirname, "..", "..", "..", "..", "install");
const bytes = readFileSync(join(folder, "install.ps1"));
const script = bytes.toString("utf8");
const posix = readFileSync(join(folder, "install.sh"), "utf8");
const manifest = readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8");
const posixFloor = /^node_floor_major=(\d+)\nnode_floor_minor=(\d+)$/m
  .exec(posix)
  ?.slice(1)
  .join(".");
const windowsFloor = /^ {2}\$NodeFloor = \[version\]'([^']+)'$/m.exec(script)?.[1];

describe("the Windows install script", () => {
  it("starts with one UTF-8 byte order mark, so Windows PowerShell reads its Chinese lines", () => {
    expect([...bytes.subarray(0, 4)]).toEqual([0xef, 0xbb, 0xbf, "#".charCodeAt(0)]);
  });

  it("pins the same Node release as the macOS and Linux script, with a hash per Windows archive", () => {
    const version = /^ {2}\$NodeVersion = '([^']+)'$/m.exec(script)?.[1];
    expect(version).toBe(/^node_version=(\S+)$/m.exec(posix)?.[1]);
    const pins = [...script.matchAll(/^ {4}'(win-[a-z0-9]+)' = '([0-9a-f]+)'$/gm)];
    expect(pins.map((pin) => pin[1])).toEqual(["win-arm64", "win-x64"]);
    expect(pins.every((pin) => pin[2]?.length === 64)).toBe(true);
  });

  it("keeps the Node floor binference's engines field names, as the other script does", () => {
    expect(windowsFloor).toBe(posixFloor);
    expect(manifest).toContain(`"node": ">=${String(posixFloor)}"`);
  });
});
