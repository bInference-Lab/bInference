import { type AccountRef, accountRefParts, accountRefSchema, type Amount } from "@binference/chain";
import type { IntentRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testAgent, testCoin, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import type { SendLevel } from "../policy/policy-rules.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { testNames, testSend, transferSimulator } from "./test-transfers.js";

const live = { signal: new AbortController().signal };
const coin: Amount = { asset: testCoin, base: 10n ** 15n };
const accounts: readonly AccountRef[] = [
  "0x000000a1",
  "0x000000f1",
  "0x000000f2",
  "0x000000e1",
].map((address) => accountRefSchema.parse(`fake:1:${address}`));
const [rescue = accounts[0] ?? accountRefSchema.parse("fake:1:0x000000a1")] = accounts;

/** One address book entry: saved in the ceiling or not, usable before or after now. */
interface Entry {
  readonly account: AccountRef;
  readonly isSaved: boolean;
  readonly usableAtMs: number;
}

/** One send: the agent's send level and book, a rescue address or none, a target and a mark. */
interface Case {
  readonly level: SendLevel;
  readonly book: readonly Entry[];
  readonly hasRescue: boolean;
  readonly target: AccountRef;
  /** How the request names its target: the address, its book entry, or a `.bnb` name for it. */
  readonly via: "address" | "entry" | "name";
  readonly isOutside: boolean;
}

const cases: fc.Arbitrary<Case> = fc.record({
  level: fc.constantFrom<SendLevel>(0, 1, 2, 3),
  book: fc.uniqueArray(
    fc.record({
      account: fc.constantFrom(...accounts.slice(1)),
      isSaved: fc.boolean(),
      usableAtMs: fc.integer({ min: testNowMs - 2, max: testNowMs + 2 }),
    }),
    { selector: (entry) => entry.account, maxLength: 3 },
  ),
  hasRescue: fc.boolean(),
  target: fc.constantFrom(...accounts),
  via: fc.constantFrom("address" as const, "entry" as const, "name" as const),
  isOutside: fc.boolean(),
});

function entryOf(entry: Entry, index: number): AddressEntryRecord {
  return {
    id: fixtureId("adr", index + 1),
    agentId: testAgent,
    account: entry.account,
    recipientBytes: accountRefParts(entry.account).address.toLowerCase(),
    label: `entry ${String(index)}`,
    usableAtMs: entry.usableAtMs,
    ...(entry.isSaved ? { inCeilingAtMs: testNowMs - 1 } : {}),
    createdAtMs: testNowMs - 10,
  };
}

// Spec 6, section 5, and decision 0091: a send reaches its card only to the rescue address in
// effect or a saved address, never at level 3, and at level 2 only once its cooling ended.
function isAllowed({ level, book, hasRescue, target, via }: Case): boolean {
  const isBooked = book.some(({ account }) => account === target);
  if (level === 3 || (via === "entry" && !isBooked)) {
    return false;
  }
  if (hasRescue && target === rescue) {
    return true;
  }
  const entry = book.find(({ account }) => account === target);
  return entry?.isSaved === true && (level < 2 || entry.usableAtMs <= testNowMs);
}

// The request's target as the case names it: an entry the book lacks is refused before any card.
function targetOf(sent: Case): Extract<IntentRequest, { kind: "send" }>["to"] {
  if (sent.via === "name") {
    return { name: "payee.bnb" };
  }
  const index = sent.book.findIndex(({ account }) => account === sent.target);
  return sent.via === "entry" ? { entry: fixtureId("adr", index + 1) } : { address: sent.target };
}

async function cardOpens(sent: Case): Promise<boolean> {
  const names = testNames();
  names.set("payee.bnb", { address: sent.target });
  const test = await startTestEngine({
    agent: { mode: "live", sendLevel: sent.level },
    nameResolvers: [names],
    chainSimulator: transferSimulator(accounts.map((to) => ({ to, amount: coin }))),
  });
  await Promise.all(
    sent.book.map(async (entry, index) =>
      test.stores.agents.addAddress(entryOf(entry, index), live),
    ),
  );
  if (sent.hasRescue) {
    const atMs = testNowMs - 2 * looseningWaitMs;
    await test.stores.install.changeRescue({ address: rescue, atMs }, live);
  }
  const caller = { ...testCallers.runtime, turn: { hasOutsideContent: sent.isOutside } };
  const proposed = await test.engine.handlers["intent/propose"](
    testCall(testSend(targetOf(sent), coin), caller),
  );
  return proposed.ok && proposed.value.state === "awaiting_confirmation";
}

describe("a send's target", () => {
  it("is never one the send level or the address book forbids", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (sent) => {
        expect(await cardOpens(sent)).toBe(isAllowed(sent));
      }),
      { numRuns: 80 },
    );
  });
});
