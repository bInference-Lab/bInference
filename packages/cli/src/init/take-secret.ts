import { BinferenceError, createSecret, ok, type Secret } from "@binference/core";
import JSON5 from "json5";
import type { z } from "zod";
import { type SecretSource, secretSourceSchema } from "../config/schema/secret-source.schema.js";
import { type InitContext, type InitStep, refused } from "./init-context.js";

/** A secret init took: its value for the checks, and the source the config names it by. */
export interface TakenSecret {
  readonly value: Secret;
  /** The source a flag named; absent for a secret the person typed, which init stores itself. */
  readonly source?: SecretSource;
}

/** Where a secret comes from: its flag, the config key it fills and its question. */
export interface SecretSpec {
  /** Such as `--bot-token`. */
  readonly flag: string;
  /** The flag's text, when it was given. */
  readonly flagText: string | undefined;
  /** The config key, such as `telegram.botToken`, which a read fault names. */
  readonly path: string;
  readonly question: { readonly id: string; readonly message: string };
}

/** Reads a flag's secret source written as in `config.json5`; `undefined` when it is none. */
export function sourceOf<T>(text: string, schema: z.ZodType<T>): T | undefined {
  try {
    const parsed = schema.safeParse(JSON5.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the secret behind a source a flag named. A source that has no secret is init's refusal
 * `init.source_unavailable`, naming the flag and why; the secret never reaches a message.
 */
export async function readFlagSecret(
  context: InitContext,
  spec: Pick<SecretSpec, "flag" | "path">,
  source: SecretSource,
): Promise<InitStep<Secret>> {
  try {
    return ok(await context.secrets.read(spec.path, source, context.signal));
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "config.secret_unavailable") {
      const reason = String(error.details["reason"] ?? "failed");
      return refused("init.source_unavailable", "refused.sourceUnavailable", {
        flag: spec.flag,
        reason,
      });
    }
    throw error;
  }
}

/**
 * Takes one secret: from the source its flag names, else typed by the person, hidden. Without a
 * person and without the flag, init stops and names the flag.
 */
export async function takeSecret(
  context: InitContext,
  spec: SecretSpec,
): Promise<InitStep<TakenSecret>> {
  if (spec.flagText !== undefined) {
    const source = sourceOf(spec.flagText, secretSourceSchema);
    if (source === undefined) {
      return refused("init.bad_source", "refused.badSource", { flag: spec.flag });
    }
    const value = await readFlagSecret(context, spec, source);
    return value.ok ? ok({ value: value.value, source }) : value;
  }
  if (!context.isInteractive) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: spec.flag });
  }
  const typed = await context.prompter.ask({
    ...spec.question,
    isSecret: true,
    check: (answer) => (answer.trim() === "" ? context.words("check.empty") : undefined),
  });
  return ok({ value: createSecret(typed.trim()) });
}
