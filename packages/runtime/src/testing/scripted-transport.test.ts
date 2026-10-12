import { describe, expect, it } from "vitest";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import { createScriptedTransport, textReply } from "./scripted-transport.js";

describe("createScriptedTransport", () => {
  it.each(
    modelTransportContract({
      create: async () => createScriptedTransport([textReply("Hello.")]),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
