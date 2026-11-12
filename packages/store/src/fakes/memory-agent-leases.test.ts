import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { nthId } from "../contracts/agent-fixtures.js";
import { agentLeasesContract } from "../contracts/agent-leases-contract.js";
import { createMemoryAgentLeases } from "./memory-agent-leases.js";

describe("memory agent leases", () => {
  it.each(
    agentLeasesContract({
      create: async () => {
        const clock = createManualClock(1_767_225_600_000);
        const installId = nthId("ins", 1);
        const leases = createMemoryAgentLeases({ installId, clock });
        return {
          leases,
          installId,
          leaseMs: 6_000,
          now: async () => clock.now(),
          passes: async (ms) => clock.advance(ms),
          rows: async () => leases.rows(),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
