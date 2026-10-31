import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { createFakeNameResolver } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";

const chain = chainRefSchema.parse("fake:1");
const alice = accountRefSchema.parse("fake:1:0x000000a1");
const vault = accountRefSchema.parse("fake:1:0x000000c1");

function resolverWithNames() {
  const resolver = createFakeNameResolver({ chain, suffix: ".fake" });
  resolver.set("alice.fake", { address: alice });
  resolver.set("bob.fake", { address: alice, reverse: { kind: "differs", other: "alice.fake" } });
  resolver.set("vault.fake", { address: vault, isContract: true });
  return resolver;
}

async function engineWith(resolver = resolverWithNames()) {
  const { engine, clock } = await startTestEngine({ nameResolvers: [resolver] });
  return { resolver, engine, clock };
}

describe("name/resolve", () => {
  it("answers the normalized name, its address, when it was read and its reverse record", async () => {
    const { engine, clock } = await engineWith();
    const answer = await engine.handlers["name/resolve"](
      testCall({ name: "Alice.FAKE" }, testCallers.mcp),
    );
    expect(answer).toStrictEqual(
      ok({
        name: "alice.fake",
        address: alice,
        resolvedAt: clock.now(),
        reverse: "matches",
      }),
    );
  });

  it("says when the address's reverse record names another name", async () => {
    const { engine } = await engineWith();
    await expect(
      engine.handlers["name/resolve"](testCall({ name: "bob.fake" })),
    ).resolves.toMatchObject({ ok: true, value: { reverse: "differs" } });
  });

  it("leaves out a reverse record the resolver could not read", async () => {
    const resolver = resolverWithNames();
    resolver.set("carol.fake", { address: alice, reverse: "unread" });
    const { engine, clock } = await engineWith(resolver);
    await expect(
      engine.handlers["name/resolve"](testCall({ name: "carol.fake" })),
    ).resolves.toStrictEqual(ok({ name: "carol.fake", address: alice, resolvedAt: clock.now() }));
  });

  it("refuses a name that points to a contract, nowhere, or under no resolver's suffix", async () => {
    const { engine } = await engineWith();
    const resolve = engine.handlers["name/resolve"];
    const answers = await Promise.all(
      ["vault.fake", "nobody.fake", "alice.other", "a_b.fake"].map(async (name) =>
        resolve(testCall({ name })),
      ),
    );
    expect(answers).toStrictEqual([
      err("name.contract"),
      err("name.not_found"),
      err("protocol.bad_args"),
      err("protocol.bad_args"),
    ]);
  });

  it("refuses every name when the engine has no resolver", async () => {
    const { engine } = await startTestEngine();
    await expect(
      engine.handlers["name/resolve"](testCall({ name: "alice.fake" })),
    ).resolves.toStrictEqual(err("protocol.bad_args"));
  });

  it("answers a resolver that cannot read the chain as down, for a later call to retry", async () => {
    const { engine, resolver } = await engineWith();
    resolver.down();
    await expect(
      engine.handlers["name/resolve"](testCall({ name: "alice.fake" })),
    ).resolves.toStrictEqual(err("name.resolver_down"));
  });

  it("rejects with the caller's reason once the caller stops", async () => {
    const { engine } = await engineWith();
    const reason = new Error("stopped");
    const call = { ...testCall({ name: "alice.fake" }), signal: AbortSignal.abort(reason) };
    await expect(engine.handlers["name/resolve"](call)).rejects.toBe(reason);
  });
});
