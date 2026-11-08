import { z } from "zod";
import { gatewayModelEntry } from "./gateway-model-list.schema.js";

/** What the gateway's image endpoint takes for one model (decision 0398). */
export interface GatewayImageModel {
  /** Whether it takes images to start from. */
  readonly readsImages: boolean;
  /** The most images one call makes. */
  readonly maxCount: number;
  readonly resolutions: readonly string[];
  readonly aspectRatios: readonly string[];
  readonly qualities: readonly string[];
  readonly outputFormats: readonly string[];
  readonly backgrounds: readonly string[];
}

const enumField = z.looseObject({ values: z.array(z.string()) });
const rangeField = z.looseObject({ max: z.number() });
const entrySchema = z.looseObject({
  id: z.string(),
  reads_images: z.boolean().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

function valuesOf(parameters: Readonly<Record<string, unknown>>, name: string): readonly string[] {
  const field = enumField.safeParse(parameters[name]);
  return field.success ? field.data.values : [];
}

/**
 * One model's entry of `GET /images/models`, the fields it takes and how many images a call makes;
 * `undefined` when the list does not hold it or does not read.
 */
export function gatewayImageModelOf(list: unknown, model: string): GatewayImageModel | undefined {
  const entry = gatewayModelEntry(list, model, entrySchema);
  if (entry === undefined) {
    return undefined;
  }
  const parameters = entry.parameters ?? {};
  const count = rangeField.safeParse(parameters["n"]);
  return {
    readsImages: entry.reads_images === true,
    maxCount: count.success ? count.data.max : 1,
    resolutions: valuesOf(parameters, "resolution"),
    aspectRatios: valuesOf(parameters, "aspect_ratio"),
    qualities: valuesOf(parameters, "quality"),
    outputFormats: valuesOf(parameters, "output_format"),
    backgrounds: valuesOf(parameters, "background"),
  };
}
