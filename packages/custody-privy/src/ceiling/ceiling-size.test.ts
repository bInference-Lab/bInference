import { describe, expect, it } from "vitest";
import {
  testBridgeCall,
  testBridgeCeilingRequest,
  testDeposits,
} from "../testing/bridge-target-fixtures.js";
import { buildCeiling } from "./build-ceiling.js";
import { ceilingBytes, maxCeilingBytes } from "./ceiling-size.js";
import type { BridgeDeposit, CeilingRequest } from "./ceiling.js";

function addresses(count: number, from = 1): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) => `0x${(index + from).toString(16).padStart(40, "0")}`,
  );
}

const [firstDeposit] = testDeposits;
const baseDeposit: BridgeDeposit = firstDeposit ?? {
  call: testBridgeCall,
  destinationChainId: "8453",
  routes: [],
};

function bytesOf(request: CeilingRequest): number | string {
  const built = buildCeiling(request);
  return built.ok ? ceilingBytes(built.value.rules) : built.error;
}

describe("the bytes a ceiling holds", () => {
  it("keeps the test ceiling with its bridge targets far below what Privy takes", () => {
    expect(bytesOf(testBridgeCeilingRequest())).toBeLessThan(maxCeilingBytes / 10);
  });

  it("refuses a ceiling past the bytes one Privy policy holds", () => {
    const saved = addresses(99);
    const deposits = Array.from({ length: 200 }, (_, index) =>
      Object.assign({}, baseDeposit, { destinationChainId: String(1_000 + index) }),
    );
    const request = testBridgeCeilingRequest();
    const wide: CeilingRequest = {
      ...request,
      saved: deposits.map((deposit) => ({ chainId: deposit.destinationChainId, addresses: saved })),
      chains: request.chains.map((chain) => Object.assign({}, chain, { bridges: deposits })),
      bridged: deposits.map((deposit) => ({
        chainId: deposit.destinationChainId,
        addresses: saved,
      })),
    };
    expect(buildCeiling(wide)).toStrictEqual({ ok: false, error: "too_large" });
  });
});
