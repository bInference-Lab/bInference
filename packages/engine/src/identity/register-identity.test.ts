import { accountRefSchema } from "@binference/chain";
import type { IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { type IdentityQuote, identityQuoteDocument } from "../intents/identity-quote.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCardText } from "../money-path/test-launches.js";
import { testAccount, testCall, testCallers, type TestEngine } from "../operations/test-engine.js";
import {
  registerRequest,
  startIdentityEngine,
  testRegistry,
  testVersion,
} from "./test-identities.js";

const live = { signal: new AbortController().signal };
const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

async function registered(test: TestEngine, description?: string): Promise<IntentView> {
  const args = description === undefined ? { agent: testAgent } : { agent: testAgent, description };
  return expectOk(await test.engine.handlers["identity/register"](testCall(args)));
}

async function quoteOf(test: TestEngine, view: IntentView): Promise<IdentityQuote> {
  const record = await test.stores.intents.get(view.intent, live);
  if (record?.quote === undefined) {
    throw new Error("The registration stored no quote.");
  }
  return identityQuoteDocument.decode(record.quote);
}

function cardLife(view: IntentView): number {
  if (view.card === undefined) {
    throw new Error("The registration has no card.");
  }
  return view.card.expiresAt - view.card.opensAt;
}

describe("an identity registration", () => {
  it("opens a 10-minute card naming every field its file publishes, and never runs alone", async () => {
    const registry = testRegistry();
    const test = await startIdentityEngine(registry);
    const view = await registered(test, "Buys dips");
    expect(view.state).toBe("awaiting_confirmation");
    const card = {
      name: "main",
      description: "Buys dips",
      wallet: testAccount,
      version: testVersion,
    };
    await expect(quoteOf(test, view)).resolves.toMatchObject({
      ...card,
      venue: "fake-identity",
      file: registry.fileOf(card),
    });
    const lines = await testCardText(test, view, "en");
    expect(lines).toContain(
      "Public on chain for good: name main, description Buys dips, account 0x0000000c, binference 2026.11.3",
    );
    expect(lines).toContain(
      `${warning} Anyone can link this account to this agent, and the record cannot be deleted`,
    );
    expect(cardLife(view)).toBe(600_000);
  });

  it("shows no description as none", async () => {
    const test = await startIdentityEngine(testRegistry());
    const lines = await testCardText(test, await registered(test), "en");
    expect(lines).toContain(
      "Public on chain for good: name main, description none, account 0x0000000c, binference 2026.11.3",
    );
  });

  it.each(["runtime", "mcp"] as const)(
    "is the owner's alone: one the %s proposes is refused, storing nothing",
    async (caller) => {
      const test = await startIdentityEngine(testRegistry());
      const asked = testCall({ agent: testAgent }, testCallers[caller]);
      await expect(test.engine.handlers["identity/register"](asked)).resolves.toStrictEqual({
        ok: false,
        error: "intent.owner_only",
      });
      const proposed = testCall(registerRequest(), testCallers[caller]);
      await expect(test.engine.handlers["intent/propose"](proposed)).resolves.toStrictEqual({
        ok: false,
        error: "intent.owner_only",
      });
      await expect(test.stores.intents.list({ states: [], limit: 10 }, live)).resolves.toHaveLength(
        0,
      );
    },
  );

  it("opens one card when two registrations of an agent come at once, the other pending", async () => {
    const test = await startIdentityEngine(testRegistry());
    const ask = async () =>
      test.engine.handlers["identity/register"](testCall({ agent: testAgent }));

    const answers = await Promise.all([ask(), ask()]);

    expect(answers).toMatchObject([
      { ok: true, value: { state: "awaiting_confirmation" } },
      { ok: false, error: "intent.identity_pending" },
    ]);
    const open = { states: ["awaiting_confirmation" as const], limit: 10 };
    await expect(test.stores.intents.list(open, live)).resolves.toHaveLength(1);
  });

  it("refuses a registration while the agent's last one has not ended", async () => {
    const test = await startIdentityEngine(testRegistry());
    await registered(test);
    await expect(
      test.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "intent.identity_pending" });
  });

  it("refuses a wallet that holds an identity already, before anything is stored", async () => {
    const registry = testRegistry();
    registry.registerOutside(testAccount);
    const test = await startIdentityEngine(registry);
    await expect(
      test.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "intent.identity_exists" });
    await expect(test.stores.intents.list({ states: [], limit: 10 }, live)).resolves.toHaveLength(
      0,
    );
  });

  it("refuses while the registry cannot be read, and with no registry at all", async () => {
    const registry = testRegistry();
    const down = await startIdentityEngine(registry);
    registry.down();
    await expect(
      down.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "quote.venue_down" });
    const none = await startIdentityEngine(testRegistry(), {
      identity: { registries: [], version: "" },
    });
    await expect(
      none.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "intent.kind_unavailable" });
  });

  it("ends a paper agent's registration with paper_only", async () => {
    const test = await startIdentityEngine(testRegistry(), { agent: { mode: "paper" } });
    await expect(registered(test)).resolves.toMatchObject({
      state: "rejected_policy",
      outcome: { reason: "paper_only" },
    });
  });

  it("ends one whose registry's proxy runs another contract with registry_changed, though it reports the version", async () => {
    const registry = testRegistry();
    registry.upgrade(accountRefSchema.parse("fake:1:0x000000e7"));
    const test = await startIdentityEngine(registry);
    await expect(registered(test)).resolves.toMatchObject({
      state: "failed_check",
      outcome: { reason: "registry_changed" },
    });
  });

  it("ends one whose registry reports another version with registry_changed, before its card", async () => {
    const registry = testRegistry();
    registry.setVersion("2.1.0");
    const test = await startIdentityEngine(registry);
    await expect(registered(test)).resolves.toMatchObject({
      state: "failed_check",
      outcome: { reason: "registry_changed" },
    });
  });

  it("ends one whose main wallet's ceiling lacks the registry's call with identity_ceiling", async () => {
    const registry = testRegistry();
    const test = await startIdentityEngine(registry, {}, "none");
    await expect(registered(test)).resolves.toMatchObject({
      state: "failed_check",
      outcome: { reason: "identity_ceiling" },
    });
  });

  it("ends one whose simulation mints no identity to the wallet with effects_differ", async () => {
    const registry = testRegistry();
    const test = await startIdentityEngine(registry, {
      chainSimulator: {
        simulate: async (drafts) =>
          Promise.resolve(drafts.map((draft) => ({ ...registry.simulate(draft), logs: [] }))),
      },
    });
    await expect(registered(test)).resolves.toMatchObject({
      state: "failed_check",
      outcome: { reason: "effects_differ" },
    });
  });

  it("answers identity/get with nothing before a registration, and an unknown agent as such", async () => {
    const test = await startIdentityEngine(testRegistry());
    await expect(
      test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    const other = fixtureId("agt", 9);
    await expect(
      test.engine.handlers["identity/get"](testCall({ agent: other })),
    ).resolves.toStrictEqual({ ok: false, error: "agent.not_found" });
  });
});
