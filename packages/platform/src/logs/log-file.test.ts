import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { openLogFile } from "./log-file.js";

const folders: string[] = [];
const dayMs = 86_400_000;
const startMs = 1_800_000_000_000;

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-log-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map(async (folder) => rm(folder, { recursive: true, maxRetries: 10, retryDelay: 200 })),
  );
});

async function linesOf(file: string): Promise<readonly string[]> {
  return (await readFile(file, "utf8")).split("\n").filter((line) => line !== "");
}

describe("the log file", () => {
  it("appends lines in the order they came and creates the file on the first line", async () => {
    const file = join(await scratchFolder(), "engine.log");
    const log = openLogFile({ file, maxBytes: 1_000, keepMs: dayMs, clock: createManualClock() });
    log.append("one");
    log.append("two");
    await log.flush();
    log.append("three");
    await log.close();
    await expect(linesOf(file)).resolves.toStrictEqual(["one", "two", "three"]);
  });

  it("ignores lines once closed", async () => {
    const file = join(await scratchFolder(), "engine.log");
    const log = openLogFile({ file, maxBytes: 1_000, keepMs: dayMs, clock: createManualClock() });
    log.append("kept");
    await log.close();
    log.append("dropped");
    await log.flush();
    await expect(linesOf(file)).resolves.toStrictEqual(["kept"]);
  });

  it("sets a full file aside under the time and starts a new one", async () => {
    const folder = await scratchFolder();
    const file = join(folder, "engine.log");
    const clock = createManualClock(startMs);
    const log = openLogFile({ file, maxBytes: 12, keepMs: dayMs, clock });
    log.append("12345");
    await log.flush();
    log.append("abcdefgh");
    await log.close();
    await expect(linesOf(file)).resolves.toStrictEqual(["abcdefgh"]);
    await expect(linesOf(join(folder, `engine.${String(startMs)}.log`))).resolves.toStrictEqual([
      "12345",
    ]);
  });

  it("removes set-aside files older than the days kept and keeps the rest", async () => {
    const folder = await scratchFolder();
    const file = join(folder, "engine.log");
    const old = `engine.${String(startMs - 15 * dayMs)}.log`;
    const recent = `engine.${String(startMs - 2 * dayMs)}.log`;
    await Promise.all(
      [old, recent, "other.1.log"].map(async (name) => writeFile(join(folder, name), "x\n")),
    );
    const clock = createManualClock(startMs);
    const log = openLogFile({ file, maxBytes: 1_000, keepMs: 14 * dayMs, clock });
    log.append("first");
    await log.close();
    await expect(readdir(folder).then((names) => names.toSorted())).resolves.toStrictEqual(
      ["engine.log", recent, "other.1.log"].toSorted(),
    );
  });

  it("drops the oldest waiting lines beyond its bound", async () => {
    const file = join(await scratchFolder(), "engine.log");
    const clock = createManualClock();
    const log = openLogFile({ file, maxBytes: 10_000, keepMs: dayMs, clock, maxQueuedLines: 2 });
    // The first line starts the writer; the next three wait, and the bound keeps the last two.
    ["a", "b", "c", "d"].forEach((line) => log.append(line));
    await log.close();
    await expect(linesOf(file)).resolves.toStrictEqual(["a", "c", "d"]);
  });

  it("reports a write that fails and never throws", async () => {
    const folder = await scratchFolder();
    // A folder where the file should be makes every append fail.
    const file = join(folder, "engine.log");
    await mkdir(file);
    const errors: BinferenceError[] = [];
    const log = openLogFile({
      file,
      maxBytes: 1_000,
      keepMs: dayMs,
      clock: createManualClock(),
      onError: (error) => errors.push(error),
    });
    log.append("lost");
    await log.close();
    expect(errors.map((error) => error.code)).toStrictEqual(["platform.log_write_failed"]);
    expect(errors[0]?.details).toStrictEqual({ path: file });
  });
});
