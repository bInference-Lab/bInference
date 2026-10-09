import { accountRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, sendRefusals, testSaved } from "../send-levels/test-sends.js";

// An address added a minute ago that the owner key has not saved in the ceiling.
const unsaved: AddressEntryRecord = {
  id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
  agentId: testAgent,
  account: accountRefSchema.parse("fake:1:0x000000f2"),
  label: "exchange",
  usableAtMs: testNowMs + looseningWaitMs,
  createdAtMs: testNowMs - 60_000,
};

describe("the policy's facts from the agent's settings", () => {
  it("let a send pay a saved entry, and refuse one the owner key has not saved", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 1 } });
    await saveTestAddress(test, unsaved);
    await saveTestAddress(test);

    expect(await sendRefusals(test)).toStrictEqual([]);
    expect(await sendRefusals(test, unsaved.account)).toStrictEqual(["unsaved_address"]);
  });

  it("make a send wait at level 2 until a new entry's 24 hours have passed", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });
    await saveTestAddress(test, { ...testSaved, usableAtMs: testNowMs + 1 });

    expect(await sendRefusals(test)).toStrictEqual(["send_level"]);
    await test.clock.advance(1);
    expect(await sendRefusals(test)).toStrictEqual([]);
  });
});
