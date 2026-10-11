import { describe, expect, it } from "vitest";
import { chainRefSchema } from "../caip/chain-ref.js";
import { createFakeChainDefinition } from "../fakes/fake-chain.js";
import { declaredContracts } from "./declared-contracts.js";

const definition = createFakeChainDefinition();
const ref = chainRefSchema.parse(definition.id);

describe("declaredContracts", () => {
  it("reads the venue's named contracts on the chain, and no other of the venue's", () => {
    const factories = definition.contracts.map((item) => ({
      ...item,
      name: "factory",
      address: "0x0000000e",
    }));
    const contracts = [...definition.contracts, ...factories];
    const chain = { ref, definition: { ...definition, contracts } };
    const venue = { id: "fake-swap", contracts: [{ chain: ref, names: ["router"] }] };

    expect(declaredContracts(venue, chain)).toStrictEqual({ ok: true, value: ["0x0000000b"] });
  });

  it("gives none on a chain the venue does not declare", () => {
    const venue = {
      id: "fake-swap",
      contracts: [{ chain: chainRefSchema.parse("fake:2"), names: ["router"] }],
    };

    expect(declaredContracts(venue, { ref, definition })).toStrictEqual({ ok: true, value: [] });
  });

  it("refuses a name the registry does not list for the venue", () => {
    const venue = { id: "other-swap", contracts: [{ chain: ref, names: ["router"] }] };

    expect(declaredContracts(venue, { ref, definition })).toStrictEqual({
      ok: false,
      error: "unknown_contract",
    });
  });
});
