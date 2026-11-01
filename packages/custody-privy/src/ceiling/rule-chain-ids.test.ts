import { chainRefSchema } from "@binference/chain";
import { createFakeChainDefinition } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { ruleChainIds, ruleChainsOf } from "./rule-chain-ids.js";

const evm = { ...createFakeChainDefinition(), id: "eip155:8453", key: "base", family: "evm" };
const other = { ...createFakeChainDefinition(), id: "fake:7", key: "other" };

describe("the chain ids a ceiling's rules bind", () => {
  it("binds an EVM chain's EIP-155 id, and none for a chain of another family", () => {
    const idsOf = ruleChainIds([evm, other]);
    expect(idsOf(chainRefSchema.parse("eip155:8453"))).toStrictEqual(["8453"]);
    expect(idsOf(chainRefSchema.parse("fake:7"))).toStrictEqual([]);
    expect(idsOf(chainRefSchema.parse("eip155:1"))).toStrictEqual([]);
  });

  it("reads an id back to the chain it stands for, and no chain for an id none gives", () => {
    const chainsOf = ruleChainsOf([evm, other]);
    expect(chainsOf("8453")).toStrictEqual([chainRefSchema.parse("eip155:8453")]);
    expect(chainsOf("7")).toStrictEqual([]);
  });
});
