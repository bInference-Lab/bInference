import { createSecret, ok } from "@binference/core";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import { promptCancelled } from "../term/prompter.js";
import type { EarlierModel } from "./earlier-answers.js";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { checkLink, linkOfFlags, linkValues, type ModelLink } from "./model-link.js";
import { isModelAddress, type ModelPreset, modelIdPattern, modelPresets } from "./model-presets.js";
import { readFlagSecret, type TakenSecret } from "./take-secret.js";

const maxTries = 3;

/** What a person answered last, offered first when the questions come again. */
interface Draft {
  readonly preset: ModelPreset;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Where the earlier set-up keeps its key, which Enter keeps using for the same provider. */
  readonly kept?: SecretSource;
}

async function askPreset(context: InitContext, draft: Draft | undefined): Promise<ModelPreset> {
  const picked = await context.prompter.choose({
    id: "modelProvider",
    message: context.words("model.provider"),
    options: modelPresets.map((preset) => ({
      value: preset.id,
      label: context.words(`model.provider.${preset.id}`),
      hint: context.words(`model.hint.${preset.id}`),
    })),
    ...(draft === undefined ? {} : { initial: draft.preset.id }),
  });
  const preset = modelPresets.find((item) => item.id === picked);
  if (preset === undefined) {
    throw promptCancelled("modelProvider");
  }
  return preset;
}

async function askBaseUrl(
  context: InitContext,
  preset: ModelPreset,
  draft: Draft | undefined,
): Promise<string | undefined> {
  if (!preset.asksBaseUrl) {
    return preset.baseUrl;
  }
  const initial = draft?.preset.kind === preset.kind ? draft.baseUrl : undefined;
  const typed = await context.prompter.ask({
    id: "modelBaseUrl",
    message: context.words("model.baseUrl"),
    ...(initial === undefined ? {} : { initial }),
    check: (answer) =>
      isModelAddress(answer.trim()) ? undefined : context.words("model.badBaseUrl"),
  });
  return typed.trim();
}

async function askModelId(
  context: InitContext,
  preset: ModelPreset,
  draft: Draft | undefined,
): Promise<string> {
  const initial = draft?.preset.id === preset.id ? draft.model : undefined;
  const typed = await context.prompter.ask({
    id: "modelName",
    message: context.words("model.name"),
    ...(initial === undefined ? {} : { initial }),
    check: (answer) =>
      modelIdPattern.test(answer.trim()) ? undefined : context.words("model.badName"),
  });
  return typed.trim();
}

function keyQuestionOf(preset: ModelPreset, kept: SecretSource | undefined): string {
  if (kept !== undefined) {
    return "model.keyKept";
  }
  return preset.asksBaseUrl ? "model.keyOptional" : "model.key";
}

// The key typed hidden. Enter keeps the earlier set-up's key of the same provider, read from where
// it is kept and never shown, or calls a compatible provider without one.
async function askKey(
  context: InitContext,
  preset: ModelPreset,
  draft: Draft | undefined,
): Promise<InitStep<TakenSecret | undefined>> {
  const kept = draft?.preset.name === preset.name ? draft.kept : undefined;
  const mayBeEmpty = kept !== undefined || preset.asksBaseUrl;
  const typed = await context.prompter.ask({
    id: "modelKey",
    message: context.words(keyQuestionOf(preset, kept)),
    isSecret: true,
    check: (answer) =>
      answer.trim() === "" && !mayBeEmpty ? context.words("check.empty") : undefined,
  });
  if (typed.trim() !== "") {
    return ok({ value: createSecret(typed.trim()) });
  }
  if (kept === undefined) {
    return ok(undefined);
  }
  const spec = { flag: "--model-key", path: `models.providers.${preset.name}.apiKey` };
  const value = await readFlagSecret(context, spec, kept);
  return value.ok ? ok({ value: value.value, source: kept }) : value;
}

async function askLink(
  context: InitContext,
  draft: Draft | undefined,
): Promise<InitStep<ModelLink>> {
  const preset = await askPreset(context, draft);
  const baseUrl = await askBaseUrl(context, preset, draft);
  const model = await askModelId(context, preset, draft);
  const key = await askKey(context, preset, draft);
  if (!key.ok) {
    return key;
  }
  return ok({
    preset,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    model,
    ...(key.value === undefined ? {} : { key: key.value }),
  });
}

async function askChecked(
  context: InitContext,
  draft: Draft | undefined,
  tries: number,
): Promise<InitStep<ModelLink>> {
  const link = await askLink(context, draft);
  if (!link.ok) {
    return link;
  }
  const values = linkValues(context, link.value);
  context.prompter.say(context.words("model.checking", values));
  const problem = await checkLink(context, link.value);
  if (problem === undefined) {
    context.prompter.say(context.words("model.checked", values));
    return link;
  }
  if (tries >= maxTries) {
    return refused(`init.model_${problem}`, `refused.model.${problem}`, values);
  }
  context.prompter.say(context.words(`model.${problem}`, values));
  const { key, ...last } = link.value;
  const kept = key?.source ?? draft?.kept;
  return askChecked(context, { ...last, ...(kept === undefined ? {} : { kept }) }, tries + 1);
}

/**
 * The model step (ARCHITECTURE section 27; decision 0221): the person picks a compatible provider,
 * its address when it is none init knows, the model and the key, typed hidden, and init checks
 * them with one small live call before it keeps anything. A failed check says why and what to do,
 * and the questions come again with the last answers first, three tries in all; then init stops.
 * A start over offers the earlier set-up's answers first and keeps its key on Enter. The
 * `--model-*` flags answer it instead, and their failed check stops init at once; a run nobody
 * answers needs them (decision 0225).
 */
export async function takeModel(
  context: InitContext,
  earlier: EarlierModel | undefined,
): Promise<InitStep<ModelLink>> {
  const { flags } = context;
  const fromFlags = flags.modelProvider !== undefined || flags.model !== undefined;
  if (!context.isInteractive || fromFlags) {
    const link = await linkOfFlags(context);
    if (!link.ok) {
      return link;
    }
    const problem = await checkLink(context, link.value);
    const values = linkValues(context, link.value);
    return problem === undefined
      ? link
      : refused(`init.model_${problem}`, `refused.model.${problem}`, values);
  }
  context.prompter.note(context.words("model.explain"), context.words("model.title"));
  const draft =
    earlier === undefined
      ? undefined
      : {
          preset: earlier.preset,
          ...(earlier.baseUrl === undefined ? {} : { baseUrl: earlier.baseUrl }),
          model: earlier.model,
          ...(earlier.apiKey === undefined ? {} : { kept: earlier.apiKey }),
        };
  return askChecked(context, draft, 1);
}
