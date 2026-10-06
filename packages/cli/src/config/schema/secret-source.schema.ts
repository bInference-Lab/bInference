import { z } from "zod";
import { formatted, pathSchema } from "./value-formats.schema.js";

/** A secret in the OS keychain entry `binference/<name>`. */
export interface KeychainSource {
  readonly fromKeychain: string;
}

/** A secret in an environment variable of the engine process. */
export interface EnvSource {
  readonly fromEnv: string;
}

/** A secret that is the whole content of an owner-only file, trimmed. */
export interface FileSource {
  readonly fromFile: string;
}

/** A secret that a program prints, run with an argument array and no shell. */
export interface CommandSource {
  /** The program, then its arguments, such as `["op", "read", "op://vault/bot/token"]`. */
  readonly fromCommand: readonly string[];
}

/** Where a config key typed `Secret` reads its value; the file never holds the value itself. */
export type SecretSource = KeychainSource | EnvSource | FileSource | CommandSource;

const commandShape = z.strictObject({
  fromCommand: z
    .array(z.string().min(1))
    .min(1)
    .describe("The program, then its arguments. No shell runs it."),
});

/** A secret read from a program's standard output, the only form `engine.unlock.command` takes. */
export const commandSourceSchema: z.ZodType<CommandSource> = commandShape.meta({
  id: "CommandSecret",
  description: "A secret printed by a program: { fromCommand: [program, ...arguments] }.",
});

/** Exactly one of `fromKeychain`, `fromEnv`, `fromFile` and `fromCommand`. */
export const secretSourceSchema: z.ZodType<SecretSource> = z
  .union([
    z.strictObject({
      fromKeychain: formatted("keychain_name").describe("The name of the keychain entry."),
    }),
    z.strictObject({ fromEnv: formatted("env_name").describe("The environment variable.") }),
    z.strictObject({ fromFile: pathSchema.describe("The file that holds only the secret.") }),
    commandShape,
  ])
  .meta({
    id: "Secret",
    description:
      "A secret source: { fromKeychain: name }, { fromEnv: variable }, { fromFile: path } or " +
      "{ fromCommand: [program, ...arguments] }. Never the secret itself.",
  });
