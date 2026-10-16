import { BinferenceError, ok } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { z } from "zod";
import { readConfigText } from "../config/config-text.js";
import { type JsonValue, jsonValueSchema } from "../config/json-value.schema.js";
import type { AnswerKey } from "./answer-names.js";
import { type InitStep, refused } from "./init-context.js";

/** What an answers file gives: each answer as a flag would give it, and its config keys. */
export interface FileAnswers {
  /** The file's path, as `--answers` or its variable named it. */
  readonly file: string;
  /** Each answer's text as its flag takes it, a secret source as JSON; a switch as a boolean. */
  readonly answers: Readonly<Partial<Record<AnswerKey, string | boolean>>>;
  /** The `set` object's keys as `--set key=value` flags, in the file's order. */
  readonly sets: readonly string[];
}

const textSchema = z.string().min(1).max(4_096);
// A secret answer is a secret source; text is kept, so the check after can refuse it as inline.
const sourceSchema = z.union([textSchema, z.record(z.string(), jsonValueSchema)]);

const fileSchema = z.strictObject({
  acceptDisclaimer: z.boolean().exactOptional(),
  modelProvider: textSchema.exactOptional(),
  modelBaseUrl: textSchema.exactOptional(),
  model: textSchema.exactOptional(),
  modelKey: sourceSchema.exactOptional(),
  privyAppId: textSchema.exactOptional(),
  privyAppSecret: sourceSchema.exactOptional(),
  ownerKeyPublic: textSchema.exactOptional(),
  rescue: textSchema.exactOptional(),
  botToken: sourceSchema.exactOptional(),
  unlock: textSchema.exactOptional(),
  unlockCommand: sourceSchema.exactOptional(),
  set: z.record(z.string().min(1), jsonValueSchema).exactOptional(),
});

function asFlagText(
  value: string | boolean | Readonly<Record<string, JsonValue>>,
): string | boolean {
  return typeof value === "string" || typeof value === "boolean" ? value : JSON.stringify(value);
}

function setOf([key, value]: readonly [string, JsonValue]): string {
  return `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`;
}

// The key a schema issue is about, never the value it found, which may be a secret.
function issueKey(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    return issue.keys[0] ?? "";
  }
  return issue.path.map(String).join(".");
}

// A file the platform cannot open, such as one of another user or over 1 MiB, is init's refusal,
// not a fault.
async function readOrRefuse(
  file: string,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof readTextFile>> | "unopened"> {
  try {
    return await readTextFile(file, signal);
  } catch (error) {
    const isUnopened =
      error instanceof BinferenceError &&
      ["platform.file_read_failed", "platform.file_too_large"].includes(error.code);
    if (isUnopened) {
      return "unopened";
    }
    throw error;
  }
}

/**
 * Reads the answers file (decision 0223): one JSON5 object whose keys are init's flags in camel
 * case, each secret as a secret source, and a `set` object of config keys. A file that is gone,
 * cannot be opened, does not parse or holds a key init does not take is init's refusal, naming
 * the file and the line or key, never a value.
 */
export async function readAnswersFile(
  file: string,
  signal: AbortSignal,
): Promise<InitStep<FileAnswers>> {
  const read = await readOrRefuse(file, signal);
  if (read === "unopened") {
    return refused("init.answers_unreadable", "refused.answersUnopened", { file });
  }
  if (!read.ok) {
    return refused("init.answers_missing", "refused.answersMissing", { file });
  }
  const text = readConfigText(read.value);
  if (!text.ok) {
    const { problem } = text;
    return problem.kind === "unreadable"
      ? refused("init.answers_invalid", "refused.answersUnreadable", {
          file,
          line: problem.line,
          column: problem.column,
        })
      : refused("init.answers_invalid", "refused.answersNotObject", { file });
  }
  const parsed = fileSchema.safeParse(text.value);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    return refused("init.answers_invalid", "refused.answersInvalid", {
      file,
      key: first === undefined ? "" : issueKey(first),
    });
  }
  const { set = {}, ...given } = parsed.data;
  const answers = Object.fromEntries(
    Object.entries(given).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, asFlagText(value)]],
    ),
  );
  return ok({ file, answers, sets: Object.entries(set).map(setOf) });
}
