import { join } from "node:path";
import { disclaimerVersion, messages } from "@binference/i18n";
import { createPlatform, listFolderFiles, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { answerNames } from "../init/answer-names.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import {
  configText,
  type InitMachine,
  initFlags,
  newInitMachine,
  rescueAddress,
  runOn,
  secretEnv,
  secretVariables,
  storedInstall,
} from "./init-fixtures.js";
import { testModelId, testModelKey } from "./model-fixtures.js";

// The model key's variable; the fixtures' runs link no model.
const modelKeyVariable = "TEST_MODEL_KEY";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const writing = { permissions: createPlatform().permissions, signal: new AbortController().signal };

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[key] ?? `missing ${key}`;

/** The answers of a server install, every secret as a source that names a variable. */
function serverAnswers(machine: InitMachine): Readonly<Record<string, unknown>> {
  return {
    acceptDisclaimer: true,
    modelProvider: "openai",
    model: testModelId,
    modelKey: { fromEnv: modelKeyVariable },
    privyAppId: machine.privy.appId,
    privyAppSecret: { fromEnv: secretVariables.appSecret },
    ownerKeyPublic: machine.ownerKey.publicKey,
    rescue: rescueAddress,
    botToken: { fromEnv: secretVariables.botToken },
    unlock: "file",
  };
}

/** Writes an answers file outside the state folder, as an owner keeps it, and answers its path. */
async function answersFile(answers: Readonly<Record<string, unknown>>): Promise<string> {
  const folder = await createTempFolder("bnf-answers-");
  folders.push(folder);
  const file = join(folder.path, "answers.json5");
  await writePrivateFile(file, JSON.stringify(answers, undefined, 2), writing);
  return file;
}

/** The variables the sources name: the Privy app secret, the bot token and the model key. */
function serverEnv(machine: InitMachine): Readonly<Record<string, string>> {
  return { ...secretEnv(machine), [modelKeyVariable]: testModelKey };
}

/** The answers as `BINFERENCE_INIT_*` variables: text as it is, a source or a switch as JSON. */
function variablesOf(answers: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    answerNames.flatMap((answer) => {
      const value = answers[answer.key];
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return value === undefined ? [] : [[answer.variable, text]];
    }),
  );
}

describe("binference init --accept-disclaimer", () => {
  it("prints both texts in full, then stores their acceptance", slow, async () => {
    const machine = await newInitMachine(folders);
    const prompter = createScriptedPrompter({});

    const argv = ["init", "--yes", "--accept-disclaimer", ...initFlags(machine)];
    const run = await runOn(machine, argv, { parts: { prompter } });

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    const text = run.stdout.indexOf(en("disclaimer.text"));
    const privacy = run.stdout.indexOf(en("disclaimer.privacy"));
    const accepted = run.stdout.indexOf(en("init.disclaimer.acceptedPrinted"));
    expect([text >= 0, privacy > text, accepted > privacy]).toStrictEqual([true, true, true]);
    expect(prompter.transcript.asked).toStrictEqual([]);
    const { facts } = await storedInstall(machine);
    expect(facts.disclaimer).toStrictEqual({
      version: disclaimerVersion,
      acceptedAtMs: machine.clock.now(),
    });
  });

  it("prints the texts on standard error beside a JSON answer", slow, async () => {
    const machine = await newInitMachine(folders);

    const argv = ["init", "--yes", "--json", "--accept-disclaimer", ...initFlags(machine)];
    const run = await runOn(machine, argv);

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ disclaimer: "accepted" });
    expect(run.stderr).toContain(en("disclaimer.text"));
    expect(run.stderr).toContain(en("disclaimer.privacy"));
  });

  it("stores nothing without the flag, and says how to accept", slow, async () => {
    const machine = await newInitMachine(folders);

    const run = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);

    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(en("disclaimer.text"));
    expect(run.stdout).toContain(en("init.disclaimer.unread"));
    expect((await storedInstall(machine)).facts.disclaimer).toBeUndefined();
  });
});

describe("binference init from BINFERENCE_INIT_ variables", () => {
  it("sets up against the fake Privy from variables alone, as a container does", slow, async () => {
    const machine = await newInitMachine(folders);
    const env = { ...serverEnv(machine), ...variablesOf(serverAnswers(machine)) };
    const prompter = createScriptedPrompter({});

    const run = await runOn(machine, ["init", "--yes", "--json"], { env, parts: { prompter } });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      state: "set_up",
      model: { provider: "openai", model: testModelId },
      disclaimer: "accepted",
    });
    expect(prompter.transcript.asked).toStrictEqual([]);
    const config = await configText(machine);
    const secrets = [testModelKey, fakeBotToken, machine.privy.appSecret.reveal()];
    expect(
      secrets.filter((secret) => `${config}${run.stdout}${run.stderr}`.includes(secret)),
    ).toStrictEqual([]);
  });
});

describe("binference init from an answers file", () => {
  it("sets up against the fake Privy from a file, with no prompt", slow, async () => {
    const machine = await newInitMachine(folders);
    const answers = { ...serverAnswers(machine), set: { "defaults.limits.perTradeUsd": "50" } };
    const file = await answersFile(answers);
    const prompter = createScriptedPrompter({});

    const argv = ["init", "--yes", "--json", "--answers", file];
    const run = await runOn(machine, argv, { env: serverEnv(machine), parts: { prompter } });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      state: "set_up",
      model: { provider: "openai", model: testModelId },
      disclaimer: "accepted",
    });
    expect(prompter.transcript.asked).toStrictEqual([]);
    expect(machine.privy.sent.length).toBeGreaterThan(0);
    const config = await configText(machine);
    expect(config).toContain('perTradeUsd: "50",');
    expect(config).toContain(`fromEnv: "${modelKeyVariable}"`);
  });

  it("takes a BINFERENCE_INIT_ variable over the file the variables name", slow, async () => {
    const machine = await newInitMachine(folders);
    const file = await answersFile({ ...serverAnswers(machine), privyAppId: "app-of-another" });
    const env = {
      ...serverEnv(machine),
      BINFERENCE_INIT_ANSWERS: file,
      BINFERENCE_INIT_PRIVY_APP_ID: machine.privy.appId,
    };

    const run = await runOn(machine, ["init", "--yes", "--json"], { env });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ state: "set_up" });
  });
});

/** The flags without one flag and its value. */
function without(flags: readonly string[], name: string): readonly string[] {
  const at = flags.indexOf(name);
  return [...flags.slice(0, at), ...flags.slice(at + 2)];
}

/** What a refused run left: the state folder's files, and how often Privy was called. */
async function leftBehind(machine: InitMachine): Promise<readonly unknown[]> {
  const files = await listFolderFiles(machine.folder, new AbortController().signal);
  return [files, machine.privy.sent.length];
}

describe("binference init refusals before anything is written", () => {
  it("names a missing answer's flag, variable and file key, and fails", slow, async () => {
    const machine = await newInitMachine(folders);
    const { rescue: _left, ...answers } = serverAnswers(machine);
    const file = await answersFile(answers);

    const run = await runOn(machine, ["init", "--yes", "--answers", file]);

    const words = en("init.refused.needsAnswer")
      .replace("{flag}", "--rescue")
      .replace("{variable}", "BINFERENCE_INIT_RESCUE")
      .replace("{key}", "rescue");
    expect([run.code, run.stderr]).toStrictEqual([1, `${words}\n`]);
    await expect(leftBehind(machine)).resolves.toStrictEqual([[], 0]);
  });

  it("refuses a secret written inline in the file, and never shows it", slow, async () => {
    const machine = await newInitMachine(folders);
    const secret = machine.privy.appSecret.reveal();
    const file = await answersFile({ ...serverAnswers(machine), privyAppSecret: secret });

    const json = await runOn(machine, ["init", "--yes", "--json", "--answers", file]);
    const plain = await runOn(machine, ["init", "--yes", "--answers", file]);

    expect([json.code, JSON.parse(json.stdout)]).toStrictEqual([
      1,
      { error: { code: "config.secret_inline" } },
    ]);
    const name = en("init.answers.inFile")
      .replace("{key}", "privyAppSecret")
      .replace("{file}", file);
    const words = en("init.refused.secretInline")
      .replace("{name}", name)
      .replace("{example}", '{ fromEnv: "PRIVY_APP_SECRET" }');
    expect([plain.code, plain.stderr]).toStrictEqual([1, `${words}\n`]);
    expect(`${json.stdout}${json.stderr}${plain.stdout}${plain.stderr}`).not.toContain(secret);
    await expect(leftBehind(machine)).resolves.toStrictEqual([[], 0]);
  });

  it("refuses a secret written inline in a variable or a flag", slow, async () => {
    const machine = await newInitMachine(folders);
    const env = { ...secretEnv(machine), BINFERENCE_INIT_BOT_TOKEN: fakeBotToken };
    const noBot = without(initFlags(machine), "--bot-token");
    const inlineKey = [...initFlags(machine), "--model-key", testModelKey];

    const fromVariable = await runOn(machine, ["init", "--yes", ...noBot], { env });
    const fromFlag = await runOn(machine, ["init", "--yes", ...inlineKey]);

    expect(fromVariable.code).toBe(1);
    expect(fromVariable.stderr).toContain("BINFERENCE_INIT_BOT_TOKEN");
    expect(fromFlag.code).toBe(1);
    expect(fromFlag.stderr).toContain('{ fromEnv: "MODEL_KEY" }');
    const shown = `${fromVariable.stdout}${fromVariable.stderr}${fromFlag.stdout}${fromFlag.stderr}`;
    expect([shown.includes(fakeBotToken), shown.includes(testModelKey)]).toStrictEqual([
      false,
      false,
    ]);
    await expect(leftBehind(machine)).resolves.toStrictEqual([[], 0]);
  });

  it("refuses a secret config key written inline in the file's set", slow, async () => {
    const machine = await newInitMachine(folders);
    const set = { "telegram.webhookSecret": "a-webhook-secret-in-plain-text" };
    const file = await answersFile({ ...serverAnswers(machine), set });

    const argv = ["init", "--yes", "--json", "--answers", file];
    const run = await runOn(machine, argv, { env: serverEnv(machine) });

    expect([run.code, JSON.parse(run.stdout)]).toMatchObject([
      1,
      { error: { code: "config.secret_inline" } },
    ]);
    expect(`${run.stdout}${run.stderr}`).not.toContain("a-webhook-secret-in-plain-text");
    expect(machine.privy.sent.map((request) => request.method)).not.toContain("POST");
    await expect(configText(machine)).resolves.toBeUndefined();
  });
});
