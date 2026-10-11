import { join } from "node:path";
import { createSecret } from "@binference/core";
import { messages } from "@binference/i18n";
import { readTextFile } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { parseOwnerKeyCode } from "@binference/signer";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import {
  createScriptedPrompter,
  type ScriptedAnswer,
  type Transcript,
} from "../term/scripted-prompter.js";
import { configText, type InitMachine, newInitMachine } from "./init-fixtures.js";
import { hostWith } from "./test-host.js";

const folders: TempFolder[] = [];
const live = new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const init = (key: string): string => messages.en[`init.${key}`] ?? `missing ${key}`;
const cli = (key: string): string => messages.en[`cli.${key}`] ?? `missing ${key}`;

// The code as the note showed it: its first line.
function shownCode(transcript: Transcript): string {
  const note = transcript.notes.find((item) => item.title === init("ownerKey.title"));
  return note?.text.split("\n")[0] ?? "";
}

function lastSix(transcript: Transcript): string {
  return shownCode(transcript).replaceAll(" ", "").slice(-6);
}

function publicHalfOf(code: string): string {
  const pair = parseOwnerKeyCode(createSecret(code));
  if (!pair.ok) {
    throw new Error("The note showed no owner key code.");
  }
  return pair.value.publicKey;
}

async function create(
  machine: InitMachine,
  options: { readonly flags?: readonly string[]; readonly checks: readonly ScriptedAnswer[] },
) {
  const prompter = createScriptedPrompter({ ownerKeyCheck: options.checks });
  const argv = ["owner-key", "create", ...(options.flags ?? [])];
  const host = hostWith(machine, argv, { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

describe("binference owner-key create", () => {
  it("shows the code once in the terminal and prints only its public half", async () => {
    const machine = await newInitMachine(folders);

    const made = await create(machine, { checks: [lastSix] });

    expect([made.code, made.stderr]).toStrictEqual([0, ""]);
    expect(made.stdout).toContain(publicHalfOf(shownCode(made.prompter.transcript)));
    expect(made.stdout).not.toContain("bnok1");
    expect(await configText(machine)).toBeUndefined();
    const database = await readTextFile(join(machine.folder, "engine.sqlite"), live);
    expect(database.ok).toBe(false);
  });

  it("makes no key with --json, --yes or nobody at the terminal", async () => {
    const machine = await newInitMachine(folders);

    const json = await create(machine, { flags: ["--json"], checks: [] });
    const yes = await create(machine, { flags: ["--yes"], checks: [] });

    expect([json.code, json.stdout]).toStrictEqual([
      1,
      `${JSON.stringify({ error: { code: "init.owner_key_needs_terminal" } })}\n`,
    ]);
    expect([yes.code, yes.stderr]).toStrictEqual([1, `${cli("ownerKey.createNeedsTerminal")}\n`]);
    expect([...json.prompter.transcript.notes, ...yes.prompter.transcript.notes]).toStrictEqual([]);
  });

  it("forgets the key after three wrong check-backs", async () => {
    const machine = await newInitMachine(folders);

    const wrong = await create(machine, { checks: ["000000", "111111", "222222"] });

    expect([wrong.code, wrong.stderr]).toStrictEqual([1, `${cli("ownerKey.createUnconfirmed")}\n`]);
    expect(wrong.stdout).not.toContain(cli("ownerKey.created").slice(0, 20));
  });
});
