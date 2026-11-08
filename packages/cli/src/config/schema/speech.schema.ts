import { voiceNameSchema } from "@binference/protocol";
import { z } from "zod";

/** How the agent speaks when the owner asks for voice (decision 0405). */
export interface SpeechConfig {
  /** The voice it speaks with: one of the speech model's voices, or of this machine's. */
  readonly voice?: string;
}

/** Parses `speech`. */
export const speechSchema: z.ZodType<SpeechConfig> = z
  .strictObject({
    voice: voiceNameSchema
      .exactOptional()
      .describe(
        "The voice the agent speaks with: one of the speech model's voices, such as alloy, or with local one of this machine's, such as Samantha; the model's or the machine's own when unset.",
      ),
  })
  .prefault({})
  .describe("How the agent speaks when the owner asks for voice.");
