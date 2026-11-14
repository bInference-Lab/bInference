import { maxJsonDepth, nestsDeeperThan } from "@binference/core";
import type { ToolCall, ToolDeclaration } from "../loop/model-message.js";
import type { ToolKind } from "../loop/turn-records.js";
import { maxArgumentsChars } from "../tools/arguments-json.schema.js";
import { fixJsonText } from "./fix-json-text.js";
import { readArguments } from "./read-arguments.js";
import type { FixedText, RepairStep } from "./repair-step.js";
import { type NameRepair, repairToolName } from "./repair-tool-name.js";
import { repairValues } from "./repair-values.js";
import { unwrapArguments } from "./unwrap-arguments.js";

/** A call as binference read it after a repair (runtime spec, section 5.6; decision 0447). */
export interface CallRepair {
  /** The declared tool the call names. */
  readonly name: string;
  /** The arguments as one line of JSON, each number as the model wrote it. */
  readonly argumentsText: string;
  /** The steps that changed the call, never empty. */
  readonly steps: readonly RepairStep[];
}

/** The tools a repair reads a call against: what the model sees, and each tool's kind. */
export interface RepairTools {
  readonly declarations: readonly ToolDeclaration[];
  /** The kind of the tool of this name, or `undefined` when none has it. */
  kindOf(name: string): ToolKind | undefined;
}

function nameOf(written: string, names: readonly string[]): NameRepair | undefined {
  return names.includes(written) ? { name: written, steps: [] } : repairToolName(written, names);
}

// The form steps, in order: what sits around the arguments, then how their JSON is written. Once
// the arguments are out of their fence or JSON string, which the tool box's depth check skipped,
// brackets nested past its depth end the repair before any step walks them (decision 0417).
function formOf(written: string): FixedText | undefined {
  if (written.trim() === "") {
    return { text: "{}", steps: [] };
  }
  const unwrapped = unwrapArguments(written);
  const fixed =
    unwrapped === undefined || nestsDeeperThan(unwrapped.text, maxJsonDepth)
      ? undefined
      : fixJsonText(unwrapped.text);
  return unwrapped === undefined || fixed === undefined
    ? undefined
    : { text: fixed.text, steps: [...unwrapped.steps, ...fixed.steps] };
}

// Only a read takes the value steps: any other call keeps the model's own values, so the call it
// is held with shows nothing the model never wrote.
function takesValues(kind: ToolKind | undefined): boolean {
  return kind === "read";
}

/**
 * Repairs a call in one pass (runtime spec, section 5.6): the tool's name, then the form of its
 * arguments, then, for a read, the values the schema names. Answers the call as binference read
 * it, which the tool box checks again as it checks any call, or `undefined` when nothing needs a
 * repair, a step cannot read the call without a guess, or what it read is longer than a call's
 * arguments may be.
 */
export function repairCall(call: ToolCall, tools: RepairTools): CallRepair | undefined {
  const names = tools.declarations.map((declaration) => declaration.name);
  const named = nameOf(call.name, names);
  const form = formOf(call.argumentsText);
  const read = form === undefined ? undefined : readArguments(form.text);
  if (named === undefined || form === undefined || read === undefined) {
    return undefined;
  }
  const declaration = tools.declarations.find((each) => each.name === named.name);
  const values =
    declaration !== undefined && takesValues(tools.kindOf(named.name))
      ? repairValues(read, declaration.parameters)
      : { value: read, steps: [] };
  const steps = [...named.steps, ...form.steps, ...values.steps];
  // A repair may write more than it read, such as each quote inside a single-quoted string
  // escaped, so what it read is held to the tool box's size as well.
  const argumentsText = JSON.stringify(values.value);
  return steps.length === 0 || argumentsText.length > maxArgumentsChars
    ? undefined
    : { name: named.name, argumentsText, steps };
}
