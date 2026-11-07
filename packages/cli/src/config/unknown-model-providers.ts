import type { ModelsConfig } from "./schema/telegram-models.schema.js";

// Every model a role names, each `<provider>/<model>`.
function modelsNamed(models: ModelsConfig): readonly string[] {
  const { main, fast, vision, imageMaking, imageInput, fallbacks } = models;
  const roles = [main, fast, vision, imageMaking].filter((model) => model !== undefined);
  return [...roles, ...imageInput, ...fallbacks.main, ...fallbacks.fast];
}

// The provider a model names: its text before the first `/`.
function providerOf(model: string): string {
  return model.slice(0, Math.max(model.indexOf("/"), 0));
}

/**
 * The models a change adds that name a provider `models.providers` does not hold, or, for the
 * image model, a provider that cannot make images (decision 0393). A model the config named
 * before the change is left alone, so an older file with a dangling name still loads and still
 * takes other changes.
 */
export function unknownModelProviders(
  before: ModelsConfig,
  after: ModelsConfig,
): readonly string[] {
  const known = new Set(modelsNamed(before));
  const added = modelsNamed(after).filter((model) => !known.has(model));
  const missing = added.filter((model) => after.providers[providerOf(model)] === undefined);
  const { imageMaking } = after;
  const isNewImageModel = imageMaking !== undefined && imageMaking !== before.imageMaking;
  const cannotMake =
    isNewImageModel && after.providers[providerOf(imageMaking)]?.kind === "anthropic";
  return cannotMake ? [...missing, imageMaking] : missing;
}
