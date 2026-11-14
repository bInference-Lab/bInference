/**
 * One step of a call repair (runtime spec, section 5.6; decision 0447), as the transcript and the
 * model's result name it. Form steps change how a call is written; value steps, only on a read or
 * a machine call, change how a field's value is written.
 */
export type RepairStep =
  | "name_prefix"
  | "name_case"
  | "fence"
  | "string_object"
  | "words_around"
  | "single_quotes"
  | "trailing_comma"
  | "closed"
  | "integer_string"
  | "null_optional";

/** Text after some repair steps, and the steps that changed it, in order. */
export interface FixedText {
  readonly text: string;
  readonly steps: readonly RepairStep[];
}
