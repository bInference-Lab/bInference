import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CeilingChain, ChainCaps } from "../ceiling/ceiling.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import { askPrivy, setUp } from "../contracts/privy-custody-setup.js";
import { isPrivyId } from "../privy/privy-records.js";
import {
  oneBnbWei,
  swapData,
  testAddresses,
  testCalls,
  testChain,
} from "../testing/custody-fixtures.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import { setCeilingCalls } from "./ceiling-calls.js";

const live = { signal: new AbortController().signal };
const { router, rescue } = testAddresses;

// The test wallet's ceiling on a fresh fake Privy, and the caps it names.
async function made(seed: number) {
  const subject = createFakeCustodySubject(seed);
  const setup = await setUp(subject);
  const wallet = await subject.api.wallet(setup.wallet.id, live);
  const policy = wallet.ok ? wallet.value.policyIds[0] : undefined;
  const held = policy === undefined ? undefined : await subject.api.policy(policy, live);
  const [caps] = (held?.ok === true ? readCeiling(held.value.rules)?.caps : undefined) ?? [];
  if (policy === undefined || !isPrivyId(policy) || caps === undefined) {
    throw new Error("Expected the wallet's ceiling and its caps.");
  }
  return { subject, setup, policy, caps: caps.caps };
}

function resized(caps: ChainCaps, nativeLimitBase: bigint): CeilingChain {
  return {
    chain: testChain,
    calls: testCalls,
    spenders: [router],
    perTxNativeCapBase: oneBnbWei,
    caps: { ...caps, native: { ...caps.native, limitBase: nativeLimitBase } },
  };
}

describe("a 24-hour cap the owner resizes on the fake Privy", () => {
  it("lets a venue call through exactly while the sum stays within the new size", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          limit: fc.bigInt({ min: oneBnbWei, max: 500n * oneBnbWei }),
          room: fc.bigInt({ min: 0n, max: oneBnbWei }),
          value: fc.bigInt({ min: 0n, max: oneBnbWei }),
          seed: fc.integer({ min: 1, max: 10_000 }),
        }),
        async ({ limit, room, value, seed }) => {
          const { subject, setup, policy, caps } = await made(seed);
          const change = {
            authorize: subject.ownerAuthorize,
            expiresAtMs: subject.clock.now() + 60_000,
            ...live,
          };
          const set = await setCeilingCalls(
            subject.api,
            { policy, chains: [resized(caps, limit)] },
            change,
          );
          expect(set.ok).toBe(true);
          // A send to the rescue address counts in the native sum and is never capped.
          const sent = await askPrivy(setup, {
            call: { to: rescue, valueWei: limit - room, data: "0x" },
          });
          expect(sent.ok).toBe(true);

          const call = { to: router, valueWei: value, data: swapData(5n) };
          expect((await askPrivy(setup, { call })).ok).toBe(value <= room);
        },
      ),
      { numRuns: 25 },
    );
  });
});
