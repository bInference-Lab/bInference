import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type FileWatch, watchFile } from "./watch-file.js";

const folders: string[] = [];
const watches: FileWatch[] = [];

afterEach(async () => {
  watches.splice(0).forEach((watching) => watching.close());
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

async function newFolder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "bnf-watch-"));
  folders.push(made);
  return made;
}

// Resolves at the first change the watch hears, or rejects once 10 seconds pass without one.
function nextChange(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const limit = AbortSignal.timeout(10_000);
    limit.addEventListener("abort", () => reject(new Error(`No change seen on ${path}.`)), {
      once: true,
    });
    watches.push(watchFile(path, { onChange: () => resolve(), onError: reject }));
  });
}

describe("a file watch", () => {
  it("hears a write to the file in place", async () => {
    const config = join(await newFolder(), "config.json5");
    await writeFile(config, "{}\n");
    const changed = nextChange(config);
    await writeFile(config, "{ logging: {} }\n");
    await expect(changed).resolves.toBeUndefined();
  });

  it("hears a new file renamed over it, as an editor saves", async () => {
    const at = await newFolder();
    const config = join(at, "config.json5");
    await writeFile(config, "{}\n");
    const changed = nextChange(config);
    await writeFile(join(at, "config.json5.tmp"), "{ logging: {} }\n");
    await rename(join(at, "config.json5.tmp"), config);
    await expect(changed).resolves.toBeUndefined();
  });

  it("names the fault when the folder cannot be watched", () => {
    const missing = join(tmpdir(), "bnf-watch-missing", "deeper", "config.json5");
    expect(() =>
      watchFile(missing, { onChange: () => undefined, onError: () => undefined }),
    ).toThrow(expect.objectContaining({ code: "platform.watch_failed" }));
  });
});
