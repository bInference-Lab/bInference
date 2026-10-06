import { describe, expect, it } from "vitest";
import { createFakeChainDefinition } from "../fakes/fake-chain.js";
import { type ChainDefinition, chainDefinitionSchema } from "./chain-definition.js";

// The first item of a fixture list, which the fixture always fills.
function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error("The fixture list is empty.");
  }
  return item;
}

const valid = createFakeChainDefinition();
const token = first(valid.tokens);
const contract = first(valid.contracts);
const rpc = first(valid.rpcs);
const undated = { ...token, verification: { ...token.verification, checkedOn: "soon" } };

describe("chain definition schema", () => {
  it("accepts a complete definition", () => {
    expect(chainDefinitionSchema.parse(valid)).toStrictEqual(valid);
  });

  it.each<[string, ChainDefinition]>([
    ["a non-CAIP id", { ...valid, id: "fake" }],
    ["an http endpoint", { ...valid, rpcs: [{ ...rpc, url: "http://rpc.example.invalid" }] }],
    ["no explorer", { ...valid, explorers: [] }],
    ["a token without a date", { ...valid, tokens: [undated] }],
    ["a token address twice", { ...valid, tokens: [token, { ...token, symbol: "TWO" }] }],
    ["a contract name twice", { ...valid, contracts: [contract, contract] }],
    ["a block time of zero", { ...valid, blockTimeMs: 0 }],
  ])("refuses %s", (_case, definition) => {
    expect(chainDefinitionSchema.safeParse(definition).success).toBe(false);
  });
});
