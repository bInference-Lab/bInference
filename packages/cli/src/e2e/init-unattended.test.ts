import { disclaimerVersion, messages } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { initFlags, newInitMachine, runOn, storedInstall } from "./init-fixtures.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[key] ?? `missing ${key}`;

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
