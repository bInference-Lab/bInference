import { testAgent, testAgentDraft, testNowMs } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const createdAt = testNowMs - 1_000;
const since = createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(createdAt);
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff";

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

describe.each(skeletonCompositions)(
  "binference approval on the $name composition",
  (composition) => {
    async function machineWithEngine(): Promise<TestMachine> {
      return (await servedMachine()).machine;
    }

    async function servedMachine() {
      const machine = await machines.create(testNowMs);
      const skeleton = await serveSkeleton(machine, composition);
      served.push(skeleton);
      return { machine, skeleton };
    }

    it("shows the only agent's mode, in English, Chinese and JSON", slow, async () => {
      const machine = await machineWithEngine();
      await expect(runOn(machine, ["approval"])).resolves.toStrictEqual({
        code: 0,
        stdout: `${testAgent} is in manual mode, since ${since}.\n`,
        stderr: "",
      });
      const json = await runOn(machine, ["approval", "--json"]);
      expect(JSON.parse(json.stdout)).toStrictEqual({
        agent: testAgent,
        mode: "manual",
        changedAt: createdAt,
      });
      const chinese = await runOn(machine, ["approval"], { LANG: "zh_CN.UTF-8" });
      const zh = createFormatter({ locale: "zh", timeZone: "UTC" });
      const values = { agent: testAgent, mode: "manual", changedAt: zh.dateTime(createdAt) };
      expect(chinese.stdout).toBe(`${zh.message("cli.approval.current", values)}\n`);
    });

    it(
      "switches to auto with its note, then back to manual, and says when nothing changes",
      slow,
      async () => {
        const machine = await machineWithEngine();
        const auto = await runOn(machine, ["approval", "auto", "--agent", testAgent]);
        expect(auto.code).toBe(0);
        expect(auto.stdout).toContain(`${testAgent} is in auto mode now`);
        expect(auto.stdout).toContain(String(messages.en["cli.approval.autoNote"]));
        const again = await runOn(machine, ["approval", "auto", "--json"]);
        expect(JSON.parse(again.stdout)).toMatchObject({ mode: "auto" });
        expect((await runOn(machine, ["approval", "auto"])).stdout).toContain(
          "in auto mode already",
        );
        const manual = await runOn(machine, ["approval", "manual", "--json"]);
        expect(JSON.parse(manual.stdout)).toMatchObject({ agent: testAgent, mode: "manual" });
      },
    );

    it(
      "says while a community plugin is on that auto mode asks, in the approval and the status",
      slow,
      async () => {
        const machine = await machines.create(testNowMs);
        const skeleton = await serveSkeleton(machine, composition, {
          communityPluginsOn: () => true,
        });
        served.push(skeleton);
        const auto = await runOn(machine, ["approval", "auto", "--agent", testAgent]);
        const json = await runOn(machine, ["approval", "--json"]);
        const chinese = await runOn(machine, ["approval"], { LANG: "zh_CN.UTF-8" });
        const status = await runOn(machine, ["status"]);
        const zhStatus = await runOn(machine, ["status"], { LANG: "zh_CN.UTF-8" });
        const zh = createFormatter({ locale: "zh", timeZone: "UTC" });

        expect(auto.stdout).toContain(String(messages.en["cli.approval.pluginAsks"]));
        expect(JSON.parse(json.stdout)).toMatchObject({ mode: "auto", autoAsks: "plugin" });
        expect(chinese.stdout).toContain(zh.message("cli.approval.pluginAsks"));
        expect(status.stdout).toContain(
          `${testAgent}: auto mode asks for every proposal while a community plugin is on`,
        );
        expect(zhStatus.stdout).toContain(
          zh.message("cli.status.autoAsksPlugin", { id: testAgent }),
        );
      },
    );

    it("names the agents to choose from when there are several", slow, async () => {
      const { machine, skeleton } = await servedMachine();
      const second = "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000aa";
      await skeleton.parts.stores.agents.create(
        testAgentDraft({ id: second as typeof testAgent, name: "second" }),
        { signal: AbortSignal.timeout(10_000) },
      );
      const several = await runOn(machine, ["approval"]);
      expect(several).toMatchObject({ code: 1, stdout: "" });
      expect(several.stderr).toBe(
        `binference has 2 agents. Name one with \`--agent\`: ${testAgent}, ${second}.\n`,
      );
      const json = await runOn(machine, ["approval", "--json"]);
      expect(JSON.parse(json.stdout)).toStrictEqual({
        error: { code: "cli.agent_needed", details: { agents: [testAgent, second] } },
      });
    });

    it(
      "answers the engine's refusal of an unknown agent in the owner's language",
      slow,
      async () => {
        const machine = await machineWithEngine();
        const english = await runOn(machine, ["approval", "--agent", unknownAgent]);
        expect(english).toStrictEqual({
          code: 1,
          stdout: "",
          stderr: `${String(messages.en["error.agent.not_found"])}\n`,
        });
        const json = await runOn(machine, ["approval", "--json", "--agent", unknownAgent]);
        expect(json.stdout).toBe('{"error":{"code":"agent.not_found"}}\n');
      },
    );

    it.each([[["approval", "sideways"]], [["approval", "--agent", "main"]]])(
      "refuses the command line %j",
      async (argv) => {
        const machine = await machines.create(testNowMs);
        await expect(runOn(machine, argv)).resolves.toMatchObject({ code: 1, stdout: "" });
      },
    );
  },
);
