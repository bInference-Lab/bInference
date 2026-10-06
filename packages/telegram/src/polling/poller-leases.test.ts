import { createSecret, type Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createPollerLeases, type PollerLease } from "./poller-leases.js";

function leaseOf(result: Result<PollerLease, string>): PollerLease {
  if (!result.ok) {
    throw new Error(`no lease: ${result.error}`);
  }
  return result.value;
}

const token = createSecret("7012345678:AAE_leaseTestToken_0123456789abcdefgh");

describe("createPollerLeases", () => {
  it("gives one lease per token until it is released", () => {
    const leases = createPollerLeases();
    const first = leases.acquire(token);
    expect(leases.acquire(createSecret(token.reveal()))).toStrictEqual({
      ok: false,
      error: "held",
    });
    expect(leases.acquire(createSecret("7012345679:AAE_otherBot")).ok).toBe(true);
    const lease = leaseOf(first);
    lease.release();
    lease.release();
    expect(leases.acquire(token).ok).toBe(true);
  });

  it("refuses a lease past its bound", () => {
    const leases = createPollerLeases();
    const taken = Array.from({ length: 16 }, (_, n) =>
      leases.acquire(createSecret(`bot-${String(n)}`)),
    );
    expect(taken.every((lease) => lease.ok)).toBe(true);
    expect(leases.acquire(createSecret("bot-16"))).toStrictEqual({ ok: false, error: "full" });
  });
});
