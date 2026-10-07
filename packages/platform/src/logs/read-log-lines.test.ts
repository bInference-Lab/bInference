import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLogLines } from "./read-log-lines.js";

const folders: string[] = [];

async function logFile(text: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-tail-"));
  folders.push(folder);
  const file = join(folder, "engine.log");
  await writeFile(file, text);
  return file;
}

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map(async (folder) => rm(folder, { recursive: true, maxRetries: 10, retryDelay: 200 })),
  );
});

const signal = (): AbortSignal => new AbortController().signal;

describe("read log lines", () => {
  it("reads the last whole lines of a file and where the next read starts", async () => {
    const file = await logFile("first\nsecond\nthird\n");
    await expect(readLogLines(file, { maxBytes: 13, signal: signal() })).resolves.toStrictEqual({
      ok: true,
      value: { lines: ["second", "third"], next: 19 },
    });
  });

  it("reads every line when the file is smaller than the limit, CRLF endings included", async () => {
    const file = await logFile("one\r\ntwo\n");
    await expect(readLogLines(file, { maxBytes: 1_000, signal: signal() })).resolves.toStrictEqual({
      ok: true,
      value: { lines: ["one", "two"], next: 9 },
    });
  });

  it("leaves a line still being written for the next read", async () => {
    const file = await logFile("done\npart");
    const first = await readLogLines(file, { maxBytes: 1_000, signal: signal() });
    expect(first).toStrictEqual({ ok: true, value: { lines: ["done"], next: 5 } });
    await appendFile(file, "ial\nnext\n");
    await expect(
      readLogLines(file, { from: 5, maxBytes: 1_000, signal: signal() }),
    ).resolves.toStrictEqual({ ok: true, value: { lines: ["partial", "next"], next: 18 } });
  });

  it("finds no line when a read holds no newline", async () => {
    const file = await logFile("no newline yet");
    await expect(
      readLogLines(file, { from: 0, maxBytes: 1_000, signal: signal() }),
    ).resolves.toStrictEqual({ ok: true, value: { lines: [], next: 0 } });
  });

  it("starts again at the top of a file shorter than where the last read ended", async () => {
    const file = await logFile("new\n");
    await expect(
      readLogLines(file, { from: 400, maxBytes: 1_000, signal: signal() }),
    ).resolves.toStrictEqual({ ok: true, value: { lines: ["new"], next: 4 } });
  });

  it("answers not_found before the file exists", async () => {
    const file = await logFile("");
    await expect(
      readLogLines(join(file, "..", "missing.log"), { maxBytes: 10, signal: signal() }),
    ).resolves.toStrictEqual({ ok: false, error: "not_found" });
  });

  it("names the path of a folder it cannot read as a file", async () => {
    const file = await logFile("");
    const folder = join(file, "..");
    await expect(readLogLines(folder, { maxBytes: 10, signal: signal() })).rejects.toMatchObject({
      code: "platform.file_read_failed",
      details: { path: folder },
    });
  });

  it("reads nothing on an aborted signal", async () => {
    const reason = new Error("stopped");
    await expect(
      readLogLines("anything", { maxBytes: 10, signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
