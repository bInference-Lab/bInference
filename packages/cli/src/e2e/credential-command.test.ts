import { testNowMs } from "@binference/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// `binference credential set` with the value typed at the masked prompt.
async function setOn(machine: TestMachine, argv: readonly string[], value: string) {
  const prompter = createScriptedPrompter({ credential: [value] });
  const host = hostWith(machine, ["credential", "set", ...argv], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

describe.each(skeletonCompositions)(
  "binference credential on the $name composition",
  (composition) => {
    async function servedMachine(): Promise<TestMachine> {
      const machine = await machines.create(testNowMs);
      served.push(await serveSkeleton(machine, composition));
      return machine;
    }

    it(
      "stores a credential from the masked prompt, lists it without its value, and deletes it",
      slow,
      async () => {
        const machine = await servedMachine();
        const stored = await setOn(
          machine,
          ["DUNE_API_KEY", "--allow-host", "api.dune.com"],
          "s3cret-value",
        );
        expect([stored.code, stored.stderr]).toStrictEqual([0, ""]);
        expect(stored.stdout).toContain("Stored DUNE_API_KEY; it may be sent to api.dune.com.");
        const listed = await runOn(machine, ["credential", "list"]);
        expect(listed.stdout).toContain("1 credential is stored:");
        expect(listed.stdout).toContain("DUNE_API_KEY: hosts api.dune.com");
        expect(listed.stdout).not.toContain("s3cret-value");
        const deleted = await runOn(machine, ["credential", "delete", "DUNE_API_KEY"]);
        expect(deleted.stdout).toBe(
          "Deleted DUNE_API_KEY; it is purged with its value in 30 days.\n",
        );
        const empty = await runOn(machine, ["credential", "list"]);
        expect(empty.stdout).toBe("No credential is stored.\n");
      },
    );

    it(
      "refuses to ask for a value with --yes, and a name that is no variable's",
      slow,
      async () => {
        const machine = await servedMachine();
        const unattended = await runOn(machine, ["credential", "set", "API_KEY", "--yes"]);
        expect(unattended.code).toBe(1);
        expect(unattended.stderr).toContain("typed at a masked prompt");
        const badName = await runOn(machine, ["credential", "set", "api_key"]);
        expect(badName.code).not.toBe(0);
      },
    );
  },
);
