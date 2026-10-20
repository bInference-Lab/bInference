import { join } from "node:path";
import { listFolderFiles } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { operations } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { type Home, onHome, portSet, setUpHome, startService } from "./home-fixtures.js";
import { noteTexts, seedNote, seedSendingTrade } from "./state-fixtures.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const homes: Home[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.services.logout()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function homeWithNote(): Promise<Home> {
  const home = await setUpHome(folders);
  homes.push(home);
  await seedNote(home.machine, "the owner keeps 20% in stablecoins");
  return home;
}

async function walletsOf(home: Home): Promise<unknown> {
  const listed = await onHome(home, ["wallet", "list", "--json"]);
  expect(listed.code).toBe(0);
  return JSON.parse(listed.stdout);
}

/** What `reset --json` prints first, before the engine's start prints its own line. */
interface ResetSummary {
  readonly backup: { readonly id: string; readonly file: string };
  readonly cleared: Record<string, number>;
}

function resetSummary(stdout: string): ResetSummary {
  const [first] = stdout.split("\n");
  if (first === undefined) {
    throw new Error("Expected reset to print its summary.");
  }
  return JSON.parse(first) as ResetSummary;
}

describe("binference reset", () => {
  it(
    "clears the chats and notes behind a sealed backup, and the wallets read as before",
    slow,
    async () => {
      const home = await homeWithNote();
      await startService(home);
      const before = await walletsOf(home);

      const reset = await onHome(home, ["reset", "--yes", "--json", ...portSet(home)]);

      expect([reset.code, reset.stderr]).toStrictEqual([0, ""]);
      const summary = resetSummary(reset.stdout);
      expect(summary.cleared).toMatchObject({ notes: 1 });
      expect(summary.backup.file.startsWith(join(home.machine.folder, "backups"))).toBe(true);
      await expect(walletsOf(home)).resolves.toStrictEqual(before);
      const status = await onHome(home, ["status", "--json"]);
      expect(operations["engine/status"].result.parse(JSON.parse(status.stdout)).state).toBe(
        "ready",
      );
      const backups = await onHome(home, ["backup", "list", "--json"]);
      const listed = operations["backup/list"].result.parse(JSON.parse(backups.stdout));
      expect(listed.items).toContainEqual(
        expect.objectContaining({ backup: summary.backup.id, kind: "manual" }),
      );
      await expect(noteTexts(home.machine)).resolves.toStrictEqual([]);
    },
  );

  it(
    "refuses while a live trade is being sent, and makes no backup and clears nothing",
    slow,
    async () => {
      const home = await homeWithNote();
      await seedSendingTrade(home.machine);

      const refused = await onHome(home, ["reset", "--yes"]);

      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("A live trade is being sent.");
      await expect(
        listFolderFiles(join(home.machine.folder, "backups"), signal()),
      ).resolves.toStrictEqual([]);
      await expect(noteTexts(home.machine)).resolves.toStrictEqual([
        "the owner keeps 20% in stablecoins",
      ]);
    },
  );

  it("asks for the phrase at a terminal, and refuses with nobody to answer", slow, async () => {
    const home = await homeWithNote();

    const refused = await onHome(home, ["reset"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("binference reset asks you to type reset first.");
    await expect(noteTexts(home.machine)).resolves.toHaveLength(1);

    const prompter = createScriptedPrompter({ resetConfirm: ["yes", "reset"] });
    const reset = await onHome(home, ["reset"], { prompter });
    expect(reset.code).toBe(0);
    expect(prompter.transcript.lines).toStrictEqual([
      "Type reset to go on, or press Ctrl+C to keep everything.",
    ]);
    expect(reset.stdout).toContain("Cleared: 0 chats with 0 messages, 1 note,");
    await expect(noteTexts(home.machine)).resolves.toStrictEqual([]);
  });
});
