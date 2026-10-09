import { messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type InitMachine, runOn, secretEnv } from "./init-fixtures.js";
import { hostWith } from "./test-host.js";
import {
  createRunningEngines,
  removeAgentKey,
  sealAgentKey,
  stateOf,
  testPassphrase,
} from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const en = (key: string): string => String(messages.en[`cli.${key}`]);

afterEach(async () => {
  await engines.stopAll();
});

async function unlock(machine: InitMachine, answers: readonly ScriptedAnswer[] = []) {
  const prompter = createScriptedPrompter({ passphrase: answers });
  const host = hostWith(machine, ["unlock"], { env: secretEnv(machine), parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), lines: prompter.transcript.lines };
}

describe("binference unlock end to end", () => {
  it("says the engine is unlocked when its key opened at start", slow, async () => {
    const machine = await engines.setUp();
    await engines.start(machine);
    await expect(unlock(machine)).resolves.toMatchObject({
      code: 0,
      stdout: `${en("unlock.done")}\n`,
    });
  });

  it("says why the engine stays locked when the key is not there", slow, async () => {
    const machine = await engines.setUp();
    await removeAgentKey(machine);
    await engines.start(machine);
    const refused = await unlock(machine);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("binference stays locked: no agent key is where");
  });

  it(
    "asks for the passphrase in the manual mode, and takes it on the third try",
    slow,
    async () => {
      const machine = await engines.setUp();
      await sealAgentKey(machine);
      await engines.start(machine);
      const unlocked = await unlock(machine, ["wrong one", "wrong two", testPassphrase]);
      expect(unlocked.code).toBe(0);
      expect(unlocked.lines.filter((line) => line === en("unlock.wrong"))).toHaveLength(2);
      expect(unlocked.stdout).toBe(`${en("unlock.done")}\n`);
      await expect(stateOf(machine)).resolves.toBe("ready");
    },
  );

  it(
    "stays locked after three wrong passphrases, and asks nobody without a terminal",
    slow,
    async () => {
      const machine = await engines.setUp();
      await sealAgentKey(machine);
      await engines.start(machine);
      const wrong = await unlock(machine, ["one", "two", "three"]);
      expect(wrong.code).toBe(1);
      expect(wrong.stderr).toContain("the passphrase does not open the agent key");
      const scripted = await runOn(machine, ["unlock", "--json"]);
      expect(scripted.code).toBe(1);
      expect(JSON.parse(scripted.stdout)).toMatchObject({ error: { code: "engine.locked" } });
      await expect(stateOf(machine)).resolves.toBe("locked");
    },
  );
});
