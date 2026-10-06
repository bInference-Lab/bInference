import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { LedgerDraft } from "./ledger-entry.js";
import { chainLedgerEntry, genesisLedgerHash, hashLedgerEntry } from "./ledger-hash.js";

const draft: LedgerDraft = {
  id: idSchema("led").parse("led_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  atMs: 1_700_000_000_000,
  agentId: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  kind: "proposed",
  subject: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  data: { venue: "venue-a", amount: "1500000000000000000" },
};

describe("hashLedgerEntry", () => {
  it("hashes the previous hash and the entry's stable JSON with snake_case keys", () => {
    // SHA-256 of 64 zeros followed by
    // {"agent_id":"agt_…01","at":1700000000000,"data":{"amount":"1500000000000000000",
    // "venue":"venue-a"},"id":"led_…01","kind":"proposed","seq":1,"subject":"int_…01"}
    expect(hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 1 })).toBe(
      "ec1d41ddb3d940c46ed4408fcc415288b39174e9b9e5e1f9ec5c90e2ac19f808",
    );
  });

  it("changes when any field or the previous hash changes", () => {
    const base = hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 1 });
    const changed = [
      hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 2 }),
      hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 1, kind: "denied" }),
      hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 1, data: { amount: "1" } }),
      hashLedgerEntry(base, { ...draft, seq: 1 }),
    ];
    expect(new Set([base, ...changed]).size).toBe(5);
  });

  it("writes an absent agent and subject as null", () => {
    const { agentId, subject, ...bare } = draft;
    expect(agentId).toBeDefined();
    expect(subject).toBeDefined();
    expect(hashLedgerEntry(genesisLedgerHash, { ...bare, seq: 1 })).not.toBe(
      hashLedgerEntry(genesisLedgerHash, { ...draft, seq: 1 }),
    );
  });
});

describe("chainLedgerEntry", () => {
  it("starts an empty ledger at seq 1 on 64 zeros and links each entry to the one before", () => {
    const first = chainLedgerEntry(undefined, draft);
    const second = chainLedgerEntry(first, { ...draft, kind: "confirmed" });
    expect([first.seq, first.prevHash]).toStrictEqual([1, "0".repeat(64)]);
    expect([second.seq, second.prevHash]).toStrictEqual([2, first.hash]);
    expect(second.hash).toBe(hashLedgerEntry(first.hash, { ...draft, kind: "confirmed", seq: 2 }));
  });
});
