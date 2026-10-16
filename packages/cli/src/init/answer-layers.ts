import { ok } from "@binference/core";
import { z } from "zod";
import { initVariablePrefix } from "../config/layers/env-layer.js";
import type { InitFlags } from "../program/cli-flags.schema.js";
import { answerLabel } from "./answer-label.js";
import { type AnswerKey, type AnswerName, type AnswerOrigin, answerNames } from "./answer-names.js";
import { type InitStep, refused } from "./init-context.js";

/** Init's flags with every answer filled from its layers, and where each one came from. */
export interface LayeredAnswers {
  readonly flags: InitFlags;
  readonly origins: ReadonlyMap<AnswerKey, AnswerOrigin>;
}

const text = z.string().min(1).max(4_096);
const switchText = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => /^(?:true|1)$/.test(value));

// Each answer's value as `InitFlags` takes it; a variable's switch is the text `true` or `false`.
const answerSchema = z.strictObject({
  acceptDisclaimer: z.union([z.boolean(), switchText]).exactOptional(),
  modelProvider: text.exactOptional(),
  modelBaseUrl: text.exactOptional(),
  model: text.exactOptional(),
  modelKey: text.exactOptional(),
  privyAppId: text.exactOptional(),
  privyAppSecret: text.exactOptional(),
  ownerKeyPublic: text.exactOptional(),
  rescue: text.exactOptional(),
  botToken: text.exactOptional(),
  unlock: z.enum(["keychain", "file", "manual", "command"]).exactOptional(),
  unlockCommand: text.exactOptional(),
});

type Env = Readonly<Record<string, string | undefined>>;

interface Found {
  readonly value: string | boolean;
  readonly origin: AnswerOrigin;
}

// An empty variable counts as unset, as the config's variables do; `false` is no flag given.
function foundOf(
  answer: AnswerName,
  layers: { readonly flags: InitFlags; readonly env: Env },
): Found | undefined {
  const flag = layers.flags[answer.key];
  if (flag !== undefined && flag !== false) {
    return { value: flag, origin: { layer: "flag" } };
  }
  const variable = layers.env[answer.variable];
  return variable === undefined || variable === ""
    ? undefined
    : { value: variable, origin: { layer: "variable", name: answer.variable } };
}

function unknownVariable(env: Env): string | undefined {
  const known = new Set(answerNames.map((answer) => answer.variable));
  return Object.keys(env)
    .toSorted()
    .find((name) => name.startsWith(initVariablePrefix) && !known.has(name));
}

/**
 * Fills init's answers from their layers (decision 0224): a flag wins over its
 * `BINFERENCE_INIT_*` variable. A variable with the prefix that answers nothing, or an answer its
 * flag would not take, is init's refusal, naming the variable or the answer, never its value.
 */
export function layeredAnswers(flags: InitFlags, env: Env): InitStep<LayeredAnswers> {
  const stray = unknownVariable(env);
  if (stray !== undefined) {
    return refused("init.unknown_variable", "refused.unknownVariable", { variable: stray });
  }
  const layers = { flags, env };
  const found = answerNames.flatMap((answer) => {
    const one = foundOf(answer, layers);
    return one === undefined ? [] : [[answer.key, one] as const];
  });
  const values = Object.fromEntries(found.map(([key, one]) => [key, one.value]));
  const parsed = answerSchema.safeParse(values);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.path[0];
    const bad = answerNames.find((answer) => answer.key === key);
    const origin = found.find(([one]) => one === key)?.[1].origin;
    const name = bad === undefined ? "" : answerLabel(bad, origin);
    return refused("init.bad_answer", "refused.badAnswer", { name });
  }
  return ok({
    flags: { ...flags, ...parsed.data },
    origins: new Map(found.map(([key, one]) => [key, one.origin])),
  });
}
