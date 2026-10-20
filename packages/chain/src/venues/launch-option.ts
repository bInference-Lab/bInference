import { z } from "zod";

/**
 * How a launch setting a launchpad declares is checked and shown: `bps` and `count` are whole
 * numbers within the option's bounds, `bps` a share of at most 10,000; `flag` is a yes or no;
 * `choice` one of the option's words; `account` an address on the launch's chain; `link` an
 * `ipfs://` or `https://` address the owner hosts, of at most 512 bytes and no control character,
 * which nothing in binference opens, fetches or reads (decision 0276); `amount` base units of the
 * launch's pair above 0, as a decimal string, which a card shows as an amount of the pair
 * (decision 0280). A `count` is never an amount of money: an amount is an `amount`.
 */
export const launchOptionTypes = [
  "bps",
  "count",
  "flag",
  "choice",
  "account",
  "link",
  "amount",
] as const;

/** The type of a launch setting. */
export type LaunchOptionType = (typeof launchOptionTypes)[number];

/** A launch setting's value as a request gives it: an account as its address text. */
export type LaunchOptionValue = number | boolean | string;

/**
 * Checks a launch's settings by name, each a number, a yes or no, or a word or account. It checks
 * no declaration: the engine checks each value against the launchpad's declared setting.
 */
export const launchOptionValuesSchema: z.ZodType<
  Readonly<Record<string, LaunchOptionValue>>,
  Readonly<Record<string, LaunchOptionValue>>
> = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]));

/**
 * One setting a launchpad takes beyond those every launch has, such as a tax on every trade. A
 * card shows it with the message `launch.option.<name>`, which must exist in every language, and
 * its value as its type says.
 */
export interface LaunchOption {
  /** Its key in a request's `venueOptions`, in camelCase, such as `taxBps`. */
  readonly name: string;
  readonly type: LaunchOptionType;
  /** The words a `choice` takes; given for a `choice` alone. */
  readonly choices?: readonly string[];
  /** The least a `bps` or a `count` takes; 0 when absent. */
  readonly min?: number;
  /** The most a `bps` or a `count` takes; 10,000 for a `bps` and no bound for a `count` when absent. */
  readonly max?: number;
  /**
   * The value when a request leaves the setting out; absent, every request must give it, unless
   * the setting is optional.
   */
  readonly default?: LaunchOptionValue;
  /**
   * A request may leave the setting out (decision 0280): the launchpad's quote then names its
   * value (`LaunchQuote.settings`), which the card shows and the create call writes, or the
   * launch runs without it. Given for a setting with no default alone.
   */
  readonly isOptional?: true;
  /**
   * An `account` that must be outside the install: the launchpad pays it only when that account
   * claims from the launchpad itself, which binference never does, so none of the install's own
   * wallets may be it (decision 0277). Given for an `account` alone.
   */
  readonly isOutsideOnly?: true;
}

const wordSchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/);

const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

// The largest whole number a JSON number holds exactly, which bounds a `count`.
const largestCount = 9_007_199_254_740_991;

// Bounds belong to numbers, words to a choice; a bps share stays within 10,000.
function isShaped(option: LaunchOption): boolean {
  const isNumber = option.type === "bps" || option.type === "count";
  const hasBounds = option.min !== undefined || option.max !== undefined;
  const isChoice = option.type === "choice";
  const ceiling = option.type === "bps" ? 10_000 : largestCount;
  const min = option.min ?? 0;
  const max = option.max ?? ceiling;
  return (
    (isNumber || !hasBounds) &&
    isChoice === (option.choices !== undefined) &&
    min <= max &&
    max <= ceiling
  );
}

// The outside rule belongs to an account alone, and an optional setting has no default.
const isOutsideShaped = (option: LaunchOption): boolean =>
  option.isOutsideOnly !== true || option.type === "account";
const isOptionalShaped = (option: LaunchOption): boolean =>
  option.isOptional !== true || option.default === undefined;

/**
 * Checks one launch setting a launchpad declares: a camelCase name of at most 32 characters, words
 * only for a `choice`, each once, and whole bounds only for a `bps` or a `count`, the least at
 * most the most. The engine checks the default's value when it hosts the launchpad.
 */
export const launchOptionSchema: z.ZodType<LaunchOption> = z
  .strictObject({
    name: wordSchema,
    type: z.enum(launchOptionTypes),
    choices: z
      .array(wordSchema)
      .min(1)
      .refine(isUnique, { message: "A choice repeats." })
      .exactOptional(),
    min: z.int().nonnegative().exactOptional(),
    max: z.int().nonnegative().exactOptional(),
    default: z.union([z.number(), z.boolean(), z.string()]).exactOptional(),
    isOutsideOnly: z.literal(true).exactOptional(),
    isOptional: z.literal(true).exactOptional(),
  })
  .refine(isShaped, { message: "Bounds or choices do not fit the setting's type." })
  .refine(isOutsideShaped, { message: "Only an account may be outside the install." })
  .refine(isOptionalShaped, { message: "An optional setting has no default." });

/** Checks a launchpad's settings: each as {@link launchOptionSchema} says, each name once. */
export const launchOptionsSchema: z.ZodType<readonly LaunchOption[]> = z
  .array(launchOptionSchema)
  .refine((options: readonly LaunchOption[]) => isUnique(options.map((option) => option.name)), {
    message: "A setting's name repeats.",
  });
