import { z } from "zod";
import { gatewayModelEntry } from "./gateway-model-list.schema.js";

/** A frame a video model starts or ends on, as the gateway names it. */
type FrameKind = "first_frame" | "last_frame";

/** What the gateway's video endpoint takes for one model (decision 0405). */
export interface GatewayVideoModel {
  /** The lengths it makes, in seconds. */
  readonly durations: readonly number[];
  readonly resolutions: readonly string[];
  readonly aspectRatios: readonly string[];
  readonly frames: readonly FrameKind[];
  /** The most reference pictures it takes; 0 for none. */
  readonly maxReferences: number;
  /** Whether it makes sound. */
  readonly sound: boolean;
  /** Whether it takes a seed. */
  readonly seed: boolean;
}

const entrySchema = z.looseObject({
  id: z.string(),
  supported_durations: z.array(z.number()).catch([]),
  supported_resolutions: z.array(z.string()).catch([]),
  supported_aspect_ratios: z.array(z.string()).catch([]),
  supported_frame_images: z.array(z.string()).catch([]),
  max_input_references: z.number().catch(0),
  generate_audio: z.boolean().catch(false),
  seed: z.boolean().catch(false),
});

function isFrame(value: string): value is FrameKind {
  return value === "first_frame" || value === "last_frame";
}

/**
 * One model's entry of `GET /videos/models`: the lengths, sizes, shapes, frames, references, sound
 * and seed it takes; `undefined` when the list does not hold it or does not read.
 */
export function gatewayVideoModelOf(list: unknown, model: string): GatewayVideoModel | undefined {
  const data = gatewayModelEntry(list, model, entrySchema);
  if (data === undefined) {
    return undefined;
  }
  return {
    durations: data.supported_durations.filter((each) => Number.isInteger(each) && each > 0),
    resolutions: data.supported_resolutions,
    aspectRatios: data.supported_aspect_ratios,
    frames: data.supported_frame_images.filter(isFrame),
    maxReferences: Math.max(0, Math.floor(data.max_input_references)),
    sound: data.generate_audio,
    seed: data.seed,
  };
}
