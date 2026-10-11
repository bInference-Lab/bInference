import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import type { AccessStore } from "../ports.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { issueLaunchTicket, launchTicketHash, launchTicketLifetimeMs } from "./launch-ticket.js";

const live = { signal: new AbortController().signal };

describe("issueLaunchTicket", () => {
  it("makes 32 random bytes in base64url and keeps only their purpose-named hash", async () => {
    const access = createMemoryAccessStore();
    const kept: unknown[] = [];
    const watched: AccessStore = {
      ...access,
      addLaunchTicket: async (record, call) => {
        kept.push(record);
        return access.addLaunchTicket(record, call);
      },
    };
    const clock = createManualClock(1_000);
    const options = { access: watched, clock, random: createSeededRandom(5) };
    const ticket = await issueLaunchTicket(options, { userId: 42, ...live });
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(launchTicketHash(ticket)).not.toBe(sha256Hex(ticket));
    expect(kept).toStrictEqual([
      {
        ticketHash: launchTicketHash(ticket),
        userId: 42,
        issuedAtMs: 1_000,
        expiresAtMs: 1_000 + launchTicketLifetimeMs,
      },
    ]);
  });

  it("refuses a ticket whose hash is already kept", async () => {
    const options = {
      access: createMemoryAccessStore(),
      clock: createManualClock(1_000),
      random: createSeededRandom(5),
    };
    await issueLaunchTicket(options, { userId: 42, ...live });
    const repeat = { ...options, random: createSeededRandom(5) };
    await expect(issueLaunchTicket(repeat, { userId: 42, ...live })).rejects.toMatchObject({
      code: "engine.ticket_taken",
    });
  });
});
