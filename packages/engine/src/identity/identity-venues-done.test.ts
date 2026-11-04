import { chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import type { IdentityRecord } from "./identity-record.js";
import { identityVenuesDone } from "./identity-venues-done.js";
import { testRegistry } from "./test-identities.js";

const live = { signal: new AbortController().signal };

function doneWith(stored: IdentityRecord | undefined) {
  return identityVenuesDone({
    identities: { get: async () => Promise.resolve(stored) },
    registries: [testRegistry()],
  });
}

describe("the venues an agent's ceilings need no more (decision 0335)", () => {
  it("are none before binference holds the agent's identity", async () => {
    expect(await doneWith(undefined)(testAgent, live)).toStrictEqual([]);
  });

  it("are the identity registries once it holds it, since an agent registers once", async () => {
    const stored = {
      agentId: testAgent,
      chain: chainRefSchema.parse("fake:1"),
      onchainId: "7",
    } as IdentityRecord;

    expect(await doneWith(stored)(testAgent, live)).toStrictEqual([testRegistry().id]);
  });
});
