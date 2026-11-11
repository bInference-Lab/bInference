import assert from "node:assert/strict";
import { idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ShellStore } from "../shell/ports.js";
import type { AllowedCommandRecord, ShellWatchRecord } from "../shell/shell-records.js";

/** Makes a fresh, empty store for each check. */
export interface ShellStoreHarness {
  create(): Promise<ShellStore>;
}

const live = { signal: new AbortController().signal };

function command(n: number, step: Partial<AllowedCommandRecord> = {}): AllowedCommandRecord {
  const id = idSchema("sac").parse(`sac_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`);
  return {
    id,
    text: "git status",
    program: "/usr/bin/git",
    args: ["status"],
    folder: "/srv/project",
    allowedAtMs: n,
    ...step,
  };
}

function watch(n: number, startedAtMs: number): ShellWatchRecord {
  return {
    job: idSchema("shj").parse(`shj_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`),
    agentId: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    command: "npm run build",
    folder: "/srv/project",
    startedAtMs,
    surface: "telegram",
  };
}

function allowedChecks(harness: ShellStoreHarness): readonly ContractCheck[] {
  return [
    {
      name: "keeps allowed commands in order and answers only the ones it kept",
      run: async () => {
        const store = await harness.create();
        const first = command(1);
        const other = command(2, { text: "git log", args: ["log"] });
        assert.deepEqual(await store.allow([first, other], live), [first, other]);
        const again = command(3);
        const elsewhere = command(4, { folder: "/srv/other" });
        assert.deepEqual(await store.allow([again, elsewhere], live), [elsewhere]);
        assert.deepEqual(await store.allowed(live), [first, other, elsewhere]);
      },
    },
    {
      name: "keeps arguments word for word, a space inside one word included",
      run: async () => {
        const store = await harness.create();
        const one = command(1, { text: "echo 'a b'", program: "/bin/echo", args: ["a b"] });
        const two = command(2, { text: "echo a b", program: "/bin/echo", args: ["a", "b"] });
        assert.deepEqual(await store.allow([one, two], live), [one, two]);
      },
    },
    {
      name: "removes an allowed command once and answers it",
      run: async () => {
        const store = await harness.create();
        const kept = command(1);
        await store.allow([kept], live);
        assert.deepEqual(await store.disallow(kept.id, live), kept);
        assert.equal(await store.disallow(kept.id, live), undefined);
        assert.deepEqual(await store.allowed(live), []);
      },
    },
  ];
}

function watchChecks(harness: ShellStoreHarness): readonly ContractCheck[] {
  return [
    {
      name: "keeps each watched job once, oldest first, until one call drops it",
      run: async () => {
        const store = await harness.create();
        await store.watch(watch(2, 20), live);
        await store.watch(watch(1, 10), live);
        await store.watch(watch(1, 10), live);
        assert.deepEqual(await store.watched(live), [watch(1, 10), watch(2, 20)]);
        assert.equal(await store.unwatch(watch(1, 10).job, live), true);
        assert.equal(await store.unwatch(watch(1, 10).job, live), false);
        assert.deepEqual(await store.watched(live), [watch(2, 20)]);
      },
    },
  ];
}

/**
 * The contract every {@link ShellStore} follows (decision 0409): allowed commands are kept once per
 * program, arguments and folder, in order; a removal answers the command once; a watched job is
 * kept once and dropped by exactly one call.
 */
export function shellStoreContract(harness: ShellStoreHarness): readonly ContractCheck[] {
  return [...allowedChecks(harness), ...watchChecks(harness)];
}
