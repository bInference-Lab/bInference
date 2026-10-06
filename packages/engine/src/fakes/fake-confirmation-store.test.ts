import type { Bps, Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { StoredIntent } from "../confirmations/stored-intent.js";
import { confirmationStoreContract } from "../contracts/confirmation-store-contract.js";
import { createFakeConfirmationStore } from "./fake-confirmation-store.js";

const held: StoredIntent = {
  intent: "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">,
  status: {
    state: "awaiting_confirmation",
    kind: "swap",
    proposer: "agent_runtime",
    isPaper: false,
    hasOutsideContent: false,
    changedAtMs: 10_000,
    quote: { quotedAtMs: 9_000, minOutBase: 1_000_000n },
    card: { version: 1, openedAtMs: 10_000, expiresAtMs: 70_000 },
  },
  version: 7,
  cards: {
    tradeExpiryMs: 60_000,
    otherExpiryMs: 600_000,
    requoteAfterMs: 10_000,
    requoteToleranceBps: 50 as Bps,
  },
};
const unknown = "int_0190f1c2-3b4c-7d5e-8f60-000000000000" as Id<"int">;
const live = { signal: new AbortController().signal };

describe("fake confirmation store", () => {
  it.each(
    confirmationStoreContract({
      create: () => ({ store: createFakeConfirmationStore([held]), held, unknown }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists the writes that landed, oldest first, and leaves out the stale ones", async () => {
    const store = createFakeConfirmationStore([held]);
    const denied = {
      intent: held.intent,
      version: held.version,
      step: {
        status: { ...held.status, state: "denied" as const },
        event: {
          from: held.status.state,
          to: "denied" as const,
          trigger: "deny_tapped" as const,
          atMs: 11_000,
          hasLedgerEntry: true,
        },
      },
    };
    await store.write(denied, live);
    await store.write(denied, live);
    expect(store.landed()).toStrictEqual([denied]);
  });

  it("keeps only the last 1,000 writes that landed", async () => {
    const store = createFakeConfirmationStore([held]);
    const step = {
      status: held.status,
      event: {
        from: held.status.state,
        to: held.status.state,
        trigger: "confirm_requoted" as const,
        atMs: 11_000,
        hasLedgerEntry: true,
      },
    };
    const versions = Array.from({ length: 1_001 }, (_, index) => held.version + index);
    // Each write yields once, so writes called in version order land in version order.
    await Promise.all(
      versions.map(async (version) => store.write({ intent: held.intent, version, step }, live)),
    );
    expect(store.landed()).toHaveLength(1_000);
    expect(store.landed()[0]?.version).toBe(held.version + 1);
  });

  it("keeps no closing or confirmation a write did not carry", async () => {
    const store = createFakeConfirmationStore([held]);
    const step = {
      status: held.status,
      event: {
        from: held.status.state,
        to: held.status.state,
        trigger: "confirm_requoted" as const,
        atMs: 11_000,
        hasLedgerEntry: true,
      },
    };
    const written = await store.write({ intent: held.intent, version: held.version, step }, live);
    expect(written).toStrictEqual({ ok: true, value: { ...held, version: held.version + 1 } });
  });
});
