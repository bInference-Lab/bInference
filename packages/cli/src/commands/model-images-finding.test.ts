import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { modelImagesFinding } from "./model-images-finding.js";

const base = { version: currentConfigVersion, telegram: { botToken: { fromEnv: "BOT" } } };
const router = { router: { kind: "binference" } };

function configWith(models: Record<string, unknown>) {
  return configSchema.parse({ ...base, models: { providers: router, ...models } });
}

describe("the image check of binference check", () => {
  it("says the main model reads images when the image list names it", () => {
    const config = configWith({ main: "router/eyes", imageInput: ["router/eyes"] });
    expect(modelImagesFinding(config)).toStrictEqual({
      check: "models.images",
      level: "ok",
      message: { key: "check.modelImages.reads", values: { model: "router/eyes" } },
      details: { model: "router/eyes", readsImages: true },
    });
  });

  it("says images go to the vision model when the main model reads none", () => {
    const config = configWith({ main: "router/text", vision: "router/eyes" });
    expect(modelImagesFinding(config)).toMatchObject({
      level: "ok",
      message: { key: "check.modelImages.vision", values: { vision: "router/eyes" } },
      details: { readsImages: false },
    });
  });

  it("warns that images are refused with no model that reads them, and skips with no model", () => {
    expect(modelImagesFinding(configWith({ main: "router/text" }))).toMatchObject({
      level: "warn",
      message: { key: "check.modelImages.refused" },
    });
    expect(modelImagesFinding(configWith({}))).toStrictEqual({
      check: "models.images",
      level: "skip",
    });
    expect(modelImagesFinding(undefined)).toStrictEqual({ check: "models.images", level: "skip" });
  });
});
