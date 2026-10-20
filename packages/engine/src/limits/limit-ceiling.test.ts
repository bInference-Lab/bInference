import { accountRefSchema, chainRefSchema, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { venuesIn } from "../ceilings/ceiling-view-of.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { venuesOutsideCeiling } from "./limit-ceiling.js";

const base = createFakeChainDefinition();
const ref = chainRefSchema.parse(base.id);
const [router] = base.contracts;
// A venue whose trades call its router, which alone reaches the venue's executor.
const definition = {
  ...base,
  contracts:
    router === undefined ? [] : [router, { ...router, name: "executor", address: "0x0000000e" }],
};
const chains = createChainRegistry({
  chains: [definition],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: agent,
  label: "main",
  createdAtMs: 0,
});

function withPolicy(policy: typeof wallet.ceiling.policy) {
  return { ...wallet, ceiling: { ...wallet.ceiling, policy } };
}

describe("a venue inside a ceiling", () => {
  it("counts once the ceiling names one of its registry contracts, as it names a router", () => {
    const named = withPolicy([{ value: ["0x0000000B"] }]);
    const check = { agent, venues: ["fake-swap"], chains };

    expect(venuesOutsideCeiling({ ...check, wallets: [named] })).toStrictEqual([]);
    expect(venuesOutsideCeiling({ ...check, wallets: [withPolicy([])] })).toStrictEqual([
      "fake-swap",
    ]);
  });

  it("shows in the ceiling's view by the contract its calls reach", () => {
    const read = {
      chains: [ref],
      contracts: [accountRefSchema.parse(`${ref}:0x0000000b`)],
      perTxNativeBase: 0n,
      recipients: [],
      dayCaps: [],
      launchCalls: [],
      functions: [],
      policy: [],
    };
    expect(venuesIn(chains, read)).toStrictEqual(["fake-swap"]);
    expect(venuesIn(chains, { ...read, contracts: [] })).toStrictEqual([]);
  });
});
