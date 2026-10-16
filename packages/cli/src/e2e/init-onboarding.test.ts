import { disclaimerVersion, messages } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { configText, initFlags, newInitMachine, runOn, storedInstall } from "./init-fixtures.js";
import { initScript, interactiveInit } from "./init-script.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[key] ?? `missing ${key}`;
const zh = (key: string): string => messages.zh[key] ?? `missing ${key}`;

describe("the onboarding steps of binference init", () => {
  it("finishes in English: the language, the disclaimer and telemetry first", slow, async () => {
    const machine = await newInitMachine(folders);

    const run = await interactiveInit(machine, initScript(machine));

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    expect(run.transcript.asked.slice(0, 4)).toStrictEqual([
      "language",
      "disclaimer",
      "telemetry",
      "privyAppId",
    ]);
    expect(run.transcript.notes.slice(0, 2)).toStrictEqual([
      { title: en("disclaimer.title"), text: en("disclaimer.text") },
      { title: en("disclaimer.privacyTitle"), text: en("disclaimer.privacy") },
    ]);
    expect(run.transcript.lines).toContain(en("init.disclaimer.accepted"));
    expect(run.transcript.lines).toContain(en("init.telemetry.none"));
    const config = await configText(machine);
    expect(config).toContain('locale: "en",');
    expect(config).toContain("enabled: false,");
    const { facts } = await storedInstall(machine);
    expect(facts.disclaimer).toStrictEqual({
      version: disclaimerVersion,
      acceptedAtMs: machine.clock.now(),
    });
  });

  it("finishes in Chinese once the person picks it, and keeps the choices", slow, async () => {
    const machine = await newInitMachine(folders);
    const script = initScript(machine, {
      language: ["zh"],
      disclaimer: ["I agree", zh("disclaimer.phrase")],
      telemetry: ["yes"],
    });

    const run = await interactiveInit(machine, script);

    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    const titles = run.transcript.notes.map((note) => note.title);
    expect(titles).toContain(zh("disclaimer.title"));
    expect(titles).toContain(zh("init.done.title"));
    const wrong = zh("init.disclaimer.wrongPhrase").replace("{phrase}", zh("disclaimer.phrase"));
    expect(run.transcript.lines).toContain(wrong);
    expect(run.transcript.lines).toContain(zh("init.telemetry.none"));
    expect(run.transcript.lines.at(-1)).toBe(zh("init.done.next"));
    const config = await configText(machine);
    expect(config).toContain('locale: "zh",');
    expect(config).toContain("enabled: true,");
  });

  it("leaves the disclaimer to going live when nobody is at the terminal", slow, async () => {
    const machine = await newInitMachine(folders);

    const run = await runOn(machine, ["init", "--yes", "--json", ...initFlags(machine)]);

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ disclaimer: "not_accepted", telemetry: false });
    expect((await storedInstall(machine)).facts.disclaimer).toBeUndefined();
    const said = await runOn(machine, ["init", "--yes", "--start-over", ...initFlags(machine)]);
    expect(said.stdout).toContain(`${en("init.disclaimer.unread")}\n`);
  });

  it(
    "starts over with the earlier answers, and asks no accepted disclaimer again",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const first = initScript(machine, { language: ["zh"], telemetry: ["yes"] });
      expect((await interactiveInit(machine, first)).code).toBe(0);

      const again = initScript(machine, { language: [""], telemetry: [""] });
      const flags = ["--unlock", "file", "--start-over"];
      const run = await interactiveInit(machine, again, { flags });

      expect([run.code, run.stderr]).toStrictEqual([0, ""]);
      expect(run.transcript.asked).not.toContain("disclaimer");
      const earlier = zh("init.disclaimer.earlier").replace(/\{date\}.*/u, "");
      expect(run.transcript.lines.some((line) => line.startsWith(earlier))).toBe(true);
      const config = await configText(machine);
      expect(config).toContain('locale: "zh",');
      expect(config).toContain("enabled: true,");
    },
  );
});
