import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { firstProgram } from "./browser-programs.js";
import { linuxBrowserPrograms, macBrowserPrograms } from "./posix/posix-browser-programs.js";
import { windowsBrowserPrograms } from "./win32/win32-browser-programs.js";

const folders: string[] = [];

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "browser-programs-"));
  folders.push(made);
  return made;
}

afterEach(() => {
  for (const made of folders.splice(0)) {
    rmSync(made, { recursive: true, force: true });
  }
});

describe("the agent's browser program", () => {
  it.skipIf(process.platform === "win32")(
    "takes the first place that holds a program it may run",
    () => {
      const root = folder();
      const plain = join(root, "plain");
      const program = join(root, "program");
      writeFileSync(plain, "");
      writeFileSync(program, "");
      chmodSync(program, 0o755);
      expect(firstProgram([join(root, "missing"), root, plain, program])).toBe(program);
      expect(firstProgram([join(root, "missing"), plain])).toBeUndefined();
    },
  );

  it("tries Google Chrome first on every OS", () => {
    expect(macBrowserPrograms("/srv/owner")[0]).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(macBrowserPrograms("/srv/owner")).toContain(
      "/srv/owner/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
    expect(linuxBrowserPrograms[0]).toBe("/usr/bin/google-chrome");
    expect(windowsBrowserPrograms("D:\\Profiles\\owner")[0]).toBe(
      "D:\\Profiles\\owner\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    );
  });
});
