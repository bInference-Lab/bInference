import { describe, expect, it } from "vitest";
import { localVoiceContract } from "../contracts/local-voice-contract.js";
import { createFakeLocalVoice } from "./fake-local-voice.js";

describe("the fake local voice", () => {
  it.each(
    localVoiceContract({
      create: async () =>
        Promise.resolve({
          voice: createFakeLocalVoice(),
          mute: createFakeLocalVoice({ mute: true }),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
