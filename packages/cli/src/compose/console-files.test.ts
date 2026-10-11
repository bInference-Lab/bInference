import { join } from "node:path";
import { createMemoryLogger } from "@binference/core/testing";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { openConsoleFiles } from "./console-files.js";

const live = { signal: new AbortController().signal };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function build(files: Readonly<Record<string, string>>): Promise<string> {
  const folder = await createTempFolder("bnf-console-");
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    const file = join(folder.path, path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a few files, each folder before its file
    await ensurePrivateFolder(join(file, ".."), { permissions: noPermissions, ...live });
    // oxlint-disable-next-line eslint/no-await-in-loop -- a few files, each folder before its file
    await writePrivateFile(file, text, { permissions: noPermissions, ...live });
  }
  return folder.path;
}

const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

describe("the console's files", () => {
  it("reads every built file by its path with slashes", async () => {
    const folder = await build({ "index.html": "<html>", "assets/index-1a.js": "run()" });
    const logger = createMemoryLogger({ subsystem: "engine" });
    const files = await openConsoleFiles(folder, { logger, ...live });
    expect(files).toBeInstanceOf(Map);
    expect([...new Map(files).keys()]).toStrictEqual(["assets/index-1a.js", "index.html"]);
    expect(decode(files?.get("assets/index-1a.js"))).toBe("run()");
  });

  it("serves no console from a build without its page, and says so in the log", async () => {
    const folder = await build({ "assets/index-1a.js": "run()" });
    const logger = createMemoryLogger({ subsystem: "engine" });
    await expect(openConsoleFiles(folder, { logger, ...live })).resolves.toBeUndefined();
    expect(logger.records()).toMatchObject([{ level: "warn", event: "server.console_missing" }]);
  });

  it("serves no console when the host names no build or the folder is gone", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    await expect(openConsoleFiles(undefined, { logger, ...live })).resolves.toBeUndefined();
    const gone = join(await build({}), "dist");
    await expect(openConsoleFiles(gone, { logger, ...live })).resolves.toBeUndefined();
  });
});
