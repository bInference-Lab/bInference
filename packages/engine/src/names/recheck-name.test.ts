import { accountRefSchema, chainRefSchema } from "@binference/chain";
import {
  createFakeFamily,
  createFakeNameResolver,
  type FakeNameRecord,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { recheckName } from "./recheck-name.js";

const chain = chainRefSchema.parse("fake:1");
const confirmed = accountRefSchema.parse("fake:1:0x000000aa");
const sameInCapitals = accountRefSchema.parse("fake:1:0x000000AA");
const other = accountRefSchema.parse("fake:1:0x000000bb");
const card = { name: "alice.fake", address: confirmed };
const options = { family: createFakeFamily(), signal: new AbortController().signal };

function resolverPointing(record: FakeNameRecord | undefined) {
  const resolver = createFakeNameResolver({ chain, suffix: ".fake" });
  resolver.set(card.name, record);
  return resolver;
}

describe("recheckName", () => {
  it("passes a name that still points to the card's address, in any spelling of it", async () => {
    await expect(
      recheckName(resolverPointing({ address: confirmed }), card, options),
    ).resolves.toStrictEqual({ kind: "same" });
    await expect(
      recheckName(resolverPointing({ address: sameInCapitals }), card, options),
    ).resolves.toStrictEqual({ kind: "same" });
  });

  it("passes whatever the address's reverse record names now", async () => {
    const reverse = { kind: "differs", other: "bob.fake" } as const;
    await expect(
      recheckName(resolverPointing({ address: confirmed, reverse }), card, options),
    ).resolves.toStrictEqual({ kind: "same" });
  });

  it("refuses a name that points elsewhere now, naming where", async () => {
    await expect(
      recheckName(resolverPointing({ address: other }), card, options),
    ).resolves.toStrictEqual({ kind: "moved", now: other });
  });

  it("passes a smart-account wallet the card showed as one", async () => {
    const resolver = resolverPointing({ address: confirmed, isSmartAccount: true });
    const smartCard = { ...card, smartAccount: true } as const;
    await expect(recheckName(resolver, smartCard, options)).resolves.toStrictEqual({
      kind: "same",
    });
  });

  it("refuses the card's address once it turned into a smart-account wallet or back", async () => {
    const turned = resolverPointing({ address: confirmed, isSmartAccount: true });
    await expect(recheckName(turned, card, options)).resolves.toStrictEqual({
      kind: "moved",
      now: confirmed,
    });
    const smartCard = { ...card, smartAccount: true } as const;
    await expect(
      recheckName(resolverPointing({ address: confirmed }), smartCard, options),
    ).resolves.toStrictEqual({ kind: "moved", now: confirmed });
  });

  it("refuses the card's address once it holds code", async () => {
    const resolver = resolverPointing({ address: confirmed, isContract: true });
    await expect(recheckName(resolver, card, options)).resolves.toStrictEqual({
      kind: "moved",
      now: confirmed,
    });
  });

  it("refuses a name that points nowhere now, or no longer reads as a name", async () => {
    await expect(recheckName(resolverPointing(undefined), card, options)).resolves.toStrictEqual({
      kind: "moved",
    });
    const malformed = { ...card, name: "alice.other" };
    await expect(
      recheckName(resolverPointing({ address: confirmed }), malformed, options),
    ).resolves.toStrictEqual({ kind: "moved" });
  });

  it("rejects when the resolver cannot read the chain", async () => {
    const resolver = resolverPointing({ address: confirmed });
    resolver.down();
    await expect(recheckName(resolver, card, options)).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
  });
});
