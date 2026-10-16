import { join } from "node:path";
import { messages } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { Transcript } from "../term/scripted-prompter.js";
import {
  type CliRun,
  configText,
  initFlags,
  type InitMachine,
  newInitMachine,
  runOn,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";
import { fileText, initScript, interactiveInit } from "./init-script.js";
import { testModelId, testModelKey } from "./model-fixtures.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const zh = (key: string): string => messages.zh[key] ?? `missing ${key}`;
const wrongKey = "sk-test-not-the-right-key-77";
const openrouter = "https://openrouter.ai/api/v1";

// Everything a run showed: its output, its errors, and the lines and notes of the terminal.
function shown(run: CliRun & { readonly transcript: Transcript }): string {
  const notes = run.transcript.notes.map((note) => `${note.title}\n${note.text}`);
  return [run.stdout, run.stderr, ...run.transcript.lines, ...notes].join("\n");
}

// The keys each model call carried, in order.
function keysSent(machine: InitMachine): readonly (string | undefined)[] {
  return machine.models.requests.map(
    (request) => request.headers?.["authorization"] ?? request.headers?.["x-api-key"],
  );
}

describe("the model step of binference init", () => {
  it("links a model it checked live, and keeps its key out of the config", slow, async () => {
    const machine = await newInitMachine(folders);
    const script = initScript(machine, {
      modelProvider: ["openrouter"],
      modelName: [testModelId],
      modelKey: [testModelKey],
    });

    const run = await interactiveInit(machine, script);

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    const values = { provider: "OpenRouter", model: testModelId };
    expect(run.transcript.lines).toContain(
      messages.en["init.model.checked"]
        ?.replace("{model}", values.model)
        .replace("{provider}", values.provider),
    );
    const config = await configText(machine);
    expect(config).toContain(`main: "openrouter/${testModelId}",`);
    expect(config).toContain(`fast: "openrouter/${testModelId}",`);
    expect(config).toContain(`baseUrl: "${openrouter}",`);
    expect(config).toContain(
      `apiKey: { fromFile: ${JSON.stringify(join(machine.folder, "keys", "openrouter-key"))} },`,
    );
    expect(config).not.toContain(testModelKey);
    await expect(fileText(machine, "keys", "openrouter-key")).resolves.toBe(`${testModelKey}\n`);
    expect(machine.models.requests.map((request) => request.url)).toStrictEqual([
      `${openrouter}/chat/completions`,
    ]);
    expect(shown(run)).not.toContain(testModelKey);
  });

  it("links an Anthropic model, in the language the person picked", slow, async () => {
    const machine = await newInitMachine(folders);
    const script = initScript(machine, {
      language: ["zh"],
      disclaimer: [zh("disclaimer.phrase")],
      telemetry: ["yes"],
      modelProvider: ["anthropic"],
    });

    const run = await interactiveInit(machine, script);

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    const titles = run.transcript.notes.map((note) => note.title);
    expect(titles).toContain(zh("disclaimer.title"));
    expect(titles).toContain(zh("init.model.title"));
    expect(titles).toContain(zh("init.done.title"));
    const config = await configText(machine);
    expect(config).toContain('locale: "zh",');
    expect(config).toContain("telemetry: {");
    expect(config).toContain("enabled: true,");
    expect(config).toContain(`main: "anthropic/${testModelId}",`);
    expect(machine.models.requests.map((request) => request.url)).toStrictEqual([
      "https://api.anthropic.com/v1/messages",
    ]);
    expect(shown(run)).not.toContain(testModelKey);
  });

  it(
    "blocks a key that fails its live check three times, before anything is made",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      // Enter keeps the provider and the model the person gave before.
      const script = initScript(machine, {
        modelProvider: ["openai", "", ""],
        modelName: [testModelId, "", ""],
        modelKey: [wrongKey, wrongKey, wrongKey],
      });

      const run = await interactiveInit(machine, script);

      expect(run.code).toBe(1);
      expect(run.stderr).toBe(
        `${String(messages.en["init.refused.model.bad_key"]).replace("{provider}", "OpenAI")}\n`,
      );
      expect(run.transcript.asked.filter((id) => id === "modelKey")).toHaveLength(3);
      expect(run.transcript.asked).not.toContain("privyAppId");
      expect(machine.privy.sent).toStrictEqual([]);
      await expect(configText(machine)).resolves.toBeUndefined();
      await expect(fileText(machine, "keys", "openai-key")).resolves.toBeUndefined();
      expect(shown(run)).not.toContain(wrongKey);
    },
  );

  it(
    "asks again after a model the provider does not know, with the last answers first",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const script = initScript(machine, {
        modelProvider: ["openai", ""],
        modelName: ["no-such-model", testModelId],
        modelKey: [testModelKey, testModelKey],
      });

      const run = await interactiveInit(machine, script);

      expect(run.code).toBe(0);
      const unknown = String(messages.en["init.model.unknown_model"])
        .replace("{provider}", "OpenAI")
        .replace("{model}", "no-such-model");
      expect(run.transcript.lines).toContain(unknown);
      expect(keysSent(machine)).toStrictEqual([`Bearer ${testModelKey}`, `Bearer ${testModelKey}`]);
    },
  );

  it("stops at once on a key from a flag that fails its live check", slow, async () => {
    const machine = await newInitMachine(folders);
    const model = ["--model-provider", "openai", "--model", testModelId];
    const argv = ["init", "--yes", "--json", ...initFlags(machine), ...model];
    const keyFlag = ["--model-key", '{ fromEnv: "TEST_MODEL_KEY" }'];

    const refused = await runOn(machine, [...argv, ...keyFlag], {
      env: { ...secretEnv(machine), TEST_MODEL_KEY: wrongKey },
    });

    expect([refused.code, refused.stdout]).toStrictEqual([
      1,
      `${JSON.stringify({ error: { code: "init.model_bad_key" } })}\n`,
    ]);
    expect(machine.privy.sent).toStrictEqual([]);
    const set = await runOn(machine, [...argv, ...keyFlag], {
      env: { ...secretEnv(machine), TEST_MODEL_KEY: testModelKey },
    });
    expect(set.code).toBe(0);
    expect(JSON.parse(set.stdout)).toMatchObject({
      model: { provider: "openai", model: testModelId },
      disclaimer: "not_accepted",
      telemetry: false,
    });
    expect(await configText(machine)).toContain('apiKey: { fromEnv: "TEST_MODEL_KEY" },');
    expect((await storedInstall(machine)).facts.disclaimer).toBeUndefined();
  });

  it("starts over with the earlier answers and the stored key, never shown", slow, async () => {
    const machine = await newInitMachine(folders);
    const first = initScript(machine, {
      telemetry: ["yes"],
      modelProvider: ["openai-compatible"],
      modelBaseUrl: ["http://localhost:11434/v1"],
    });
    expect((await interactiveInit(machine, first)).code).toBe(0);

    const again = initScript(machine, {
      language: [""],
      telemetry: [""],
      modelProvider: [""],
      modelBaseUrl: [""],
      modelName: [""],
      modelKey: [""],
    });
    const run = await interactiveInit(machine, again, {
      flags: ["--unlock", "file", "--start-over"],
    });

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    expect(run.transcript.asked).not.toContain("disclaimer");
    expect(
      run.transcript.lines.some((line) => line.startsWith("You accepted this disclaimer")),
    ).toBe(true);
    const config = await configText(machine);
    expect(config).toContain('baseUrl: "http://localhost:11434/v1",');
    expect(config).toContain(`main: "compatible/${testModelId}",`);
    expect(config).toContain("enabled: true,");
    expect(keysSent(machine)).toStrictEqual([`Bearer ${testModelKey}`, `Bearer ${testModelKey}`]);
    expect(shown(run)).not.toContain(testModelKey);
  });
});
