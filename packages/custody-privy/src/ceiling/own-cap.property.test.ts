import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callData } from "../testing/bridge-fixtures.js";
import { stakingAddresses, testStakingCeilingRequest } from "../testing/bridge-target-fixtures.js";
import { ceilingVerdict } from "../testing/ceiling-verdict.js";
import { oneBnbWei, swapData, testAddresses, testCaps } from "../testing/custody-fixtures.js";

const wallet = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const validator = "0x85e99B4093C337A9d5EF478bE8E95d2632a638DD";
const stakeCap = 100n * oneBnbWei;
// A native 24-hour cap far above any value here, so only the caps per call decide.
const caps = { ...testCaps, native: { ...testCaps.native, limitBase: 10n ** 30n } };
const request = testStakingCeilingRequest(caps);

// Values around both caps: the wallet's cap per call and the stake's own.
const values = fc.constantFrom(
  0n,
  oneBnbWei,
  oneBnbWei + 1n,
  oneBnbWei + oneBnbWei / 10n,
  stakeCap,
  stakeCap + 1n,
  10n ** 24n,
);

// Payable calls the ceiling lists: the stakes with their own cap, then calls under the cap per call.
const calls = fc.constantFrom(
  { to: stakingAddresses.stakeHub, data: callData.delegate(validator), cap: stakeCap },
  { to: stakingAddresses.stakeHub, data: callData.undelegate(validator), cap: oneBnbWei },
  { to: stakingAddresses.stakeManager, data: callData.deposit(), cap: stakeCap },
  { to: stakingAddresses.stakeManager, data: callData.requestWithdraw(), cap: oneBnbWei },
  { to: testAddresses.router, data: swapData(1n), cap: oneBnbWei },
);

// What the ceiling answers a call of the value: allowed up to its cap.
const expected = (valueWei: bigint, cap: bigint): string => (valueWei <= cap ? "ALLOW" : "DENY");

describe("a call with a cap of its own under Privy's policy semantics (decision 0325)", () => {
  it("allows the stake up to its own cap and every other call up to the cap per call, no more", () => {
    fc.assert(
      fc.property(calls, values, (call, valueWei) => {
        const verdict = ceilingVerdict(request, {
          chainId: 56n,
          to: call.to,
          valueWei,
          data: call.data,
          walletAddress: wallet,
        });
        expect(verdict).toBe(expected(valueWei, call.cap));
      }),
    );
  });

  it("allows a stake to no other contract, whatever its value", () => {
    fc.assert(
      fc.property(values, (valueWei) => {
        const tx = { chainId: 56n, to: testAddresses.router, valueWei, walletAddress: wallet };
        expect(ceilingVerdict(request, { ...tx, data: callData.delegate(validator) })).toBe("DENY");
      }),
    );
  });
});
