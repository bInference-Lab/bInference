import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CheckFinding } from "./check-finding.js";

const check = "models.images";

/**
 * `models.images` (decision 0228): where the owner's images go, read from the config with no
 * call. The main model reads them when `models.imageInput` names it; else the vision model does
 * when `models.vision` names one; else binference refuses them, a warning that says how to fix it.
 * Without a config or a main model it is skipped.
 */
export function modelImagesFinding(config: BinferenceConfig | undefined): CheckFinding {
  const main = config?.models.main;
  if (config === undefined || main === undefined) {
    return { check, level: "skip" };
  }
  const { vision, imageInput } = config.models;
  if (imageInput.includes(main)) {
    const details = { model: main, readsImages: true };
    return {
      check,
      level: "ok",
      message: { key: "check.modelImages.reads", values: { model: main } },
      details,
    };
  }
  if (vision !== undefined) {
    const values = { model: main, vision };
    return {
      check,
      level: "ok",
      message: { key: "check.modelImages.vision", values },
      details: { ...values, readsImages: false },
    };
  }
  const message = { key: "check.modelImages.refused", values: { model: main } };
  return { check, level: "warn", message, details: { model: main, readsImages: false } };
}
