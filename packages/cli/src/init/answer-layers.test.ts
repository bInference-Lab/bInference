import { join } from "node:path";
import { createPlatform, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type InitFlags, initFlagsSchema } from "../program/cli-flags.schema.js";
import { layeredAnswers } from "./answer-layers.js";
import { answerNames } from "./answer-names.js";

const folders: TempFolder[] = [];
const writing = { permissions: createPlatform().permissions, signal: new AbortController().signal };

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const run = {
  signal: new AbortController().signal,
  words: (key: string, values?: Readonly<Record<string, unknown>>) =>
    `${key} ${JSON.stringify(values)}`,
};

function flagsOf(given: Readonly<Record<string, unknown>> = {}): InitFlags {
  return initFlagsSchema.parse({ yes: true, ...given });
}

async function answersFile(text: string): Promise<string> {
  const folder = await createTempFolder("bnf-answers-");
  folders.push(folder);
  const file = join(folder.path, "answers.json5");
  await writePrivateFile(file, text, writing);
  return file;
}

describe("init's answer layers", () => {
  it("names each answer's flag and variable after the flag", () => {
    const appId = answerNames.find((answer) => answer.key === "privyAppId");
    expect(appId).toMatchObject({
      flag: "--privy-app-id",
      variable: "BINFERENCE_INIT_PRIVY_APP_ID",
    });
  });

  it("takes a flag over its variable, and a variable over the file", async () => {
    const file = await answersFile(`{
      // Comments are allowed, as in config.json5.
      privyAppId: "from-file",
      rescue: "0xfile",
      model: "file-model",
      set: { "owner.locale": "zh", "defaults.limits.perTradeUsd": 50 },
    }`);
    const env = { BINFERENCE_INIT_PRIVY_APP_ID: "from-variable", BINFERENCE_INIT_RESCUE: "0xvar" };
    const flags = flagsOf({ answers: file, privyAppId: "from-flag", set: ["owner.locale=en"] });

    const layered = await layeredAnswers(flags, env, run);

    expect(layered).toMatchObject({
      ok: true,
      value: {
        flags: {
          privyAppId: "from-flag",
          rescue: "0xvar",
          model: "file-model",
          sets: ["owner.locale=zh", "defaults.limits.perTradeUsd=50", "owner.locale=en"],
        },
        origins: new Map([
          ["privyAppId", { layer: "flag" }],
          ["rescue", { layer: "variable", name: "BINFERENCE_INIT_RESCUE" }],
          ["model", { layer: "file", file }],
        ]),
      },
    });
  });

  it("finds the file by its variable, and reads a secret source and a switch", async () => {
    const file = await answersFile(
      '{ botToken: { fromEnv: "BOT_TOKEN" }, acceptDisclaimer: true }',
    );

    const layered = await layeredAnswers(flagsOf(), { BINFERENCE_INIT_ANSWERS: file }, run);

    expect(layered).toMatchObject({
      ok: true,
      value: { flags: { botToken: '{"fromEnv":"BOT_TOKEN"}', acceptDisclaimer: true } },
    });
  });

  it("reads a variable's switch, and leaves out an empty variable", async () => {
    const env = { BINFERENCE_INIT_ACCEPT_DISCLAIMER: "1", BINFERENCE_INIT_RESCUE: "" };

    const layered = await layeredAnswers(flagsOf(), env, run);

    expect(layered).toMatchObject({ ok: true, value: { flags: { acceptDisclaimer: true } } });
    expect(layered).not.toHaveProperty(["value", "flags", "rescue"]);
  });

  it("refuses a variable with the prefix that answers nothing", async () => {
    const env = { BINFERENCE_INIT_PRIVY_APPID: "x" };

    await expect(layeredAnswers(flagsOf(), env, run)).resolves.toStrictEqual({
      ok: false,
      refusal: {
        code: "init.unknown_variable",
        key: "refused.unknownVariable",
        values: { variable: "BINFERENCE_INIT_PRIVY_APPID" },
      },
    });
  });

  it("names a bad answer by where it came from, never by its value", async () => {
    const env = { BINFERENCE_INIT_ACCEPT_DISCLAIMER: "maybe" };
    const file = await answersFile('{ unlock: "vault" }');

    const fromVariable = await layeredAnswers(flagsOf(), env, run);
    const fromFile = await layeredAnswers(flagsOf({ answers: file }), {}, run);

    expect(fromVariable).toMatchObject({
      refusal: { code: "init.bad_answer", values: { name: "BINFERENCE_INIT_ACCEPT_DISCLAIMER" } },
    });
    const inFile = `answers.inFile ${JSON.stringify({ key: "unlock", file })}`;
    expect(fromFile).toMatchObject({
      refusal: { code: "init.bad_answer", values: { name: inFile } },
    });
    expect(JSON.stringify([fromVariable, fromFile])).not.toMatch(/maybe|vault/u);
  });
});
