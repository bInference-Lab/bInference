import type { ModelsConfig, ProviderConfig } from "./schema/telegram-models.schema.js";

// Every model a role names, each `<provider>/<model>`; `local` speech names no model.
function modelsNamed(models: ModelsConfig): readonly string[] {
  const { main, fast, vision, imageMaking, videoMaking, imageInput, fallbacks } = models;
  const speech = models.speech === "local" ? undefined : models.speech;
  const roles = [main, fast, vision, imageMaking, videoMaking, speech].filter(
    (model) => model !== undefined,
  );
  return [...roles, ...imageInput, ...fallbacks.main, ...fallbacks.fast];
}

// The provider a model names: its text before the first `/`.
function providerOf(model: string): string {
  return model.slice(0, Math.max(model.indexOf("/"), 0));
}

/** A role whose model only some kinds of provider serve, and whether a kind serves it. */
interface KindBoundRole {
  readonly role: "imageMaking" | "videoMaking" | "speech";
  readonly serves: (kind: ProviderConfig["kind"]) => boolean;
}

// Images come from any provider but Anthropic (decision 0393), videos only from the bInference
// gateway, and speech only from an openai provider (decision 0405).
const kindBoundRoles: readonly KindBoundRole[] = [
  { role: "imageMaking", serves: (kind) => kind !== "anthropic" },
  { role: "videoMaking", serves: (kind) => kind === "binference" },
  { role: "speech", serves: (kind) => kind === "openai" },
];

// The models a change newly names for a role whose provider cannot serve that role.
function unservedModels(before: ModelsConfig, after: ModelsConfig): readonly string[] {
  return kindBoundRoles.flatMap(({ role, serves }) => {
    const model = after[role];
    if (model === undefined || model === "local" || model === before[role]) {
      return [];
    }
    const kind = after.providers[providerOf(model)]?.kind;
    return kind === undefined || serves(kind) ? [] : [model];
  });
}

/**
 * The models a change adds that name a provider `models.providers` does not hold, or, for the
 * image, video and speech models, a provider of a kind that cannot serve them (decisions 0393 and
 * 0405). A model the config named before the change is left alone, so an older file with a
 * dangling name still loads and still takes other changes.
 */
export function unknownModelProviders(
  before: ModelsConfig,
  after: ModelsConfig,
): readonly string[] {
  const known = new Set(modelsNamed(before));
  const added = modelsNamed(after).filter((model) => !known.has(model));
  const missing = added.filter((model) => after.providers[providerOf(model)] === undefined);
  return [...missing, ...unservedModels(before, after)];
}
