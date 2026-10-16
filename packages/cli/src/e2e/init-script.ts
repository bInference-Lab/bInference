import { join } from "node:path";
import { messages } from "@binference/i18n";
import { readTextFile } from "@binference/platform";
import { fakeBotToken } from "@binference/telegram/testing";
import {
  createScriptedPrompter,
  type ScriptedAnswer,
  type Transcript,
} from "../term/scripted-prompter.js";
import { type CliRun, type InitMachine, rescueAddress, runOn, secretEnv } from "./init-fixtures.js";
import { testModelId, testModelKey } from "./model-fixtures.js";
import type { HostParts } from "./test-host.js";

/** A script of answers by question id, in the order each question takes them. */
export type InitScript = Readonly<Record<string, readonly ScriptedAnswer[]>>;

// The note's title in either language: the owner key's code is shown whatever the language.
const ownerKeyTitles = new Set(
  Object.values(messages).map((catalog) => catalog["init.ownerKey.title"]),
);

/** The owner key's code as the note showed it: its first line, the code in groups of five. */
export function shownCode(transcript: Transcript): string {
  const note = transcript.notes.find((item) => ownerKeyTitles.has(item.title));
  return note?.text.split("\n")[0] ?? "";
}

/** The last six characters of the owner key's code, as a person types them back. */
export function lastSix(transcript: Transcript): string {
  return shownCode(transcript).replaceAll(" ", "").slice(-6);
}

/** A file of the machine's state folder, or `undefined` when nothing is there. */
export async function fileText(
  machine: InitMachine,
  ...path: string[]
): Promise<string | undefined> {
  const read = await readTextFile(join(machine.folder, ...path), new AbortController().signal);
  return read.ok ? read.value : undefined;
}

/**
 * The answers of a person who sets up in English with the defaults: accepts the disclaimer,
 * shares no usage counts, links the fake provider's model at OpenAI's API, and answers the Privy
 * app, the owner key's check-back, the rescue address, the bot and the limits; `changes` replace
 * the answers of the questions they name.
 */
export function initScript(machine: InitMachine, changes: InitScript = {}): InitScript {
  return {
    language: [""],
    disclaimer: ["I understand"],
    telemetry: [""],
    modelProvider: ["openai"],
    modelName: [testModelId],
    modelKey: [testModelKey],
    privyAppId: [machine.privy.appId],
    privyAppSecret: [machine.privy.appSecret.reveal()],
    ownerKeyCheck: [lastSix],
    rescue: [rescueAddress],
    botToken: [fakeBotToken],
    perTradeUsd: [""],
    rollingDayUsd: [""],
    ...changes,
  };
}

/** Runs `binference init` with a person at the terminal who answers from the script. */
export async function interactiveInit(
  machine: InitMachine,
  answers: InitScript,
  options: {
    readonly flags?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly parts?: HostParts;
  } = {},
): Promise<CliRun & { readonly transcript: Transcript }> {
  const prompter = createScriptedPrompter(answers);
  const run = await runOn(machine, ["init", ...(options.flags ?? ["--unlock", "file"])], {
    env: { ...secretEnv(machine), ...options.env },
    parts: { prompter, ...options.parts },
  });
  return { ...run, transcript: prompter.transcript };
}
