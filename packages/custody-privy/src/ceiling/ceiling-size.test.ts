import { describe, expect, it } from "vitest";
import {
  testBridgeCall,
  testBridgeCeilingRequest,
  testTargets,
} from "../testing/bridge-target-fixtures.js";
import { buildCeiling } from "./build-ceiling.js";
import { ceilingBytes, maxCeilingBytes } from "./ceiling-size.js";
import type { BridgeTarget, CeilingRequest } from "./ceiling.js";

function addresses(count: number, from = 1): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) => `0x${(index + from).toString(16).padStart(40, "0")}`,
  );
}

function withTargets(targets: readonly BridgeTarget[]): CeilingRequest {
  const request = testBridgeCeilingRequest();
  const chains = request.chains.map((chain) => Object.assign({}, chain, { bridges: targets }));
  return { ...request, chains };
}

const [firstTarget] = testTargets;
const baseTarget: BridgeTarget = firstTarget ?? {
  call: testBridgeCall,
  destinationChainId: "8453",
  recipients: [],
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
    const targets = Array.from({ length: 60 }, (_, index) =>
      Object.assign({}, baseTarget, {
        destinationChainId: String(1_000 + index),
        recipients: addresses(100, index * 100 + 1),
      }),
    );
    expect(buildCeiling(withTargets(targets))).toStrictEqual({ ok: false, error: "too_large" });
  });
});
