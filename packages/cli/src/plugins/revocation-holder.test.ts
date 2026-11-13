import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createListingSigner } from "./fake-listing-signer.js";
import {
  asPayload,
  listingFixture,
  listingIdFixture,
  revocationListFixture,
} from "./listing-fixtures.js";
import { createListingKeys } from "./listing-keys.js";
import type { RevocationList } from "./plugin-listing.schema.js";
import { createRevocationHolder } from "./revocation-holder.js";

const startMs = 1_767_261_600_000;
const signer = createListingSigner();
const keys = createListingKeys([signer.spki]);
const signed = (list: RevocationList): string => signer.sign("pluginRevocations", asPayload(list));
const list = (sequence: number, overrides: Partial<RevocationList> = {}): RevocationList =>
  revocationListFixture({ sequence, issuedAt: startMs, ...overrides });

function holder() {
  const clock = createManualClock(startMs);
  return { clock, held: createRevocationHolder({ keys, clock }) };
}

describe("holding the revocation list", () => {
  it("takes a list that passes and holds it while it is good", async () => {
    const { clock, held } = holder();
    const first = list(1, { revoked: [listingIdFixture(1)] });

    expect(held.take(signed(first))).toStrictEqual({ ok: true, value: first });
    expect(held.fresh()).toStrictEqual(first);
    expect(held.floor()).toMatchObject({ sequence: 1, key: signer.id });
    await clock.advance(3_600_000);
    expect(held.fresh()).toBeUndefined();
  });

  it("refuses an older list and keeps the one it holds", () => {
    const { held } = holder();
    held.take(signed(list(5)));

    expect(held.take(signed(list(4)))).toStrictEqual({ ok: false, error: "older" });
    expect(held.fresh()?.sequence).toBe(5);
  });

  it("takes the same list again, and refuses another list of its sequence", () => {
    const { held } = holder();
    const first = list(6);
    held.take(signed(first));

    expect(held.take(signed(first)).ok).toBe(true);
    expect(held.take(signed(list(6, { revoked: [listingIdFixture(1)] })))).toStrictEqual({
      ok: false,
      error: "forked",
    });
  });

  it("refuses a list that leaves out a listing the list before named", () => {
    const { held } = holder();
    held.take(signed(list(6, { revoked: [listingIdFixture(1)] })));

    expect(held.take(signed(list(7)))).toStrictEqual({ ok: false, error: "shrank" });
  });

  it("refuses a list signed more than 5 minutes ahead, or one that has expired", async () => {
    const { clock, held } = holder();
    const ahead = list(2, { issuedAt: startMs + 300_001 });

    expect(held.take(signed(list(1, { issuedAt: startMs + 300_000 }))).ok).toBe(true);
    expect(held.take(signed(ahead))).toStrictEqual({ ok: false, error: "early" });
    await clock.advance(3_600_000);
    expect(held.take(signed(list(3)))).toStrictEqual({ ok: false, error: "expired" });
  });

  it("refuses an envelope another key signed, and a payload that is no list", () => {
    const { held } = holder();
    const other = createListingSigner();
    const listingPayload = signer.sign("pluginRevocations", asPayload(listingFixture()));

    expect(held.take(other.sign("pluginRevocations", asPayload(list(1))))).toStrictEqual({
      ok: false,
      error: "unverified",
    });
    expect(held.take(listingPayload)).toStrictEqual({ ok: false, error: "malformed" });
  });

  it("starts from a floor and drops one set by a key no longer in force", () => {
    const clock = createManualClock(startMs);
    const floor = { sequence: 9, key: signer.id, digest: "d".repeat(64) };
    const kept = createRevocationHolder({ keys, clock, floor });
    const gone = createRevocationHolder({ keys, clock, floor: { ...floor, key: "e".repeat(32) } });

    expect(kept.take(signed(list(8)))).toStrictEqual({ ok: false, error: "older" });
    expect(gone.floor()).toBeUndefined();
    expect(gone.take(signed(list(1))).ok).toBe(true);
  });
});
