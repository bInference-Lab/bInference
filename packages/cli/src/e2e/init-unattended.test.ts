import { disclaimerVersion, messages } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
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

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[key] ?? `missing ${key}`;

const modelKeyVariable = "TEST_MODEL_KEY";

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

/** The variables the sources name: the Privy app secret, the bot token and the model key. */
function serverEnv(machine: InitMachine): Readonly<Record<string, string>> {
  return { ...secretEnv(machine), [modelKeyVariable]: testModelKey };
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
