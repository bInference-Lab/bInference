import { accountRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, sendRefusals, testSaved } from "../send-levels/test-sends.js";

const live = { signal: new AbortController().signal };
const unknownAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
// An address added a minute ago that the owner key has not saved in the ceiling.
const unsaved: AddressEntryRecord = {
  id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
  agentId: testAgent,
  account: accountRefSchema.parse("fake:1:0x000000f2"),
  label: "exchange",
  usableAtMs: testNowMs + looseningWaitMs,
  createdAtMs: testNowMs - 60_000,
};

function list(test: TestEngine, agent = testAgent) {
  return test.engine.handlers["address/list"](testCall({ agent }));
}

function remove(test: TestEngine, entry = testSaved.id) {
  return test.engine.handlers["address/remove"](testCall({ entry }));
}

describe("the address book operations", () => {
  it("list the live entries oldest first, with when each may be paid", async () => {
    const test = await startTestEngine();
    await saveTestAddress(test, unsaved);
    await saveTestAddress(test);

    expect(await list(test)).toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            entry: testSaved.id,
            agent: testAgent,
            address: testSaved.account,
            label: "savings",
            usableAt: testSaved.usableAtMs,
            inCeilingAt: testSaved.inCeilingAtMs,
            createdAt: testSaved.createdAtMs,
          },
          {
            entry: unsaved.id,
            agent: testAgent,
            address: unsaved.account,
            label: "exchange",
            usableAt: unsaved.usableAtMs,
            createdAt: unsaved.createdAtMs,
          },
        ],
      },
    });
  });

  it("remove an entry at once, journaled, so a send to it is refused", async () => {
    const test = await startTestEngine();
    await saveTestAddress(test);

    expect(await remove(test)).toStrictEqual({ ok: true, value: {} });
    expect(await sendRefusals(test)).toStrictEqual(["unsaved_address"]);
    expect(await list(test)).toStrictEqual({ ok: true, value: { items: [] } });
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(entries).toMatchObject([
      {
        atMs: testNowMs,
        surface: "cli",
        path: `agents.main.addressBook.${testSaved.id}`,
        before: { entry: testSaved.id, address: testSaved.account },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(1);
  });

  it("refuse an entry that is unknown or removed, and an unknown agent", async () => {
    const test = await startTestEngine();
    await saveTestAddress(test);
    await remove(test);

    expect(await remove(test)).toStrictEqual(err("address.not_found"));
    expect(await list(test, unknownAgent)).toStrictEqual(err("agent.not_found"));
  });
});
