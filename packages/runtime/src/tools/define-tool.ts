import { BinferenceError, type JsonValue } from "@binference/core";
import { z } from "zod";
import type { ToolDeclaration } from "../loop/model-message.js";
import type { PreparedCall, ToolKind, ToolOutcome, ToolRunContext } from "../loop/turn-ports.js";
import {
  type ArgumentsProblem,
  maxArgumentsChars,
  maxArgumentsDepth,
  parseArgumentsJson,
} from "./arguments-json.schema.js";
import { allowsUnnamedFields, coerces, inputJsonSchema } from "./schema-rules.schema.js";

/** How a tool is declared: its name, kind and description, its arguments' schema, and its body. */
export interface ToolSpec<Args> {
  readonly name: string;
  readonly kind: ToolKind;
  /** What the model reads to decide when to call it. */
  readonly description: string;
  /**
   * The arguments' zod schema, a `z.strictObject`. It parses without coercion: money is a decimal
   * string of base units (`decimalStringSchema`), never a number.
   */
  readonly args: z.ZodType<Args>;
  /** A read that may run beside other such reads. */
  readonly parallel?: boolean;
  /** Every result of this tool is outside content (runtime spec, section 5.4). */
  readonly outside?: boolean;
  /**
   * A control tool that asks the owner a question (`ask_owner`): a proposal in its batch wins
   * over it (decision 0173).
   */
  readonly asksOwner?: boolean;
  run(args: Args, context: ToolRunContext): Promise<ToolOutcome>;
}

/** A declared tool: what the model sees of it, and each call to it checked. */
export interface AgentTool {
  readonly name: string;
  readonly declaration: ToolDeclaration;
  /** Checks a call's arguments; a call that passes is ready to run with them. */
  prepare(argumentsText: string): PreparedCall;
}

/** The most text of a result the model reads (runtime spec, section 5.2). */
export const maxResultChars = 12_000;

const toolName = /^[a-z][a-z0-9_]{0,63}$/;

function invalidTool(name: string, reason: string): BinferenceError {
  return new BinferenceError({
    code: "runtime.tool_invalid",
    message: `The tool ${name} is declared wrong: ${reason}.`,
  });
}

// The model sees the schema of what it writes: the input side, where money is a string. Every
// object is strict and nothing coerces, so a call is checked as the model wrote it.
function parametersOf(name: string, args: z.ZodType): { readonly [key: string]: JsonValue } {
  if (coerces(args)) {
    throw invalidTool(name, "a field of its arguments coerces what it reads");
  }
  const parameters = inputJsonSchema(args);
  if (parameters?.["type"] !== "object") {
    throw invalidTool(name, "its arguments are not a JSON object");
  }
  if (allowsUnnamedFields(parameters)) {
    throw invalidTool(name, "an object of its arguments allows fields it does not name");
  }
  return parameters;
}

/** Cuts a result to {@link maxResultChars}, with a line saying how much was cut. */
export function cutResult(text: string): string {
  if (text.length <= maxResultChars) {
    return text;
  }
  // A pair of UTF-16 halves cut in two would leave half a character.
  const end = /[\uD800-\uDBFF]/.test(text.charAt(maxResultChars - 1))
    ? maxResultChars - 1
    : maxResultChars;
  return `${text.slice(0, end)}\n[cut: ${String(text.length - end)} more characters]`;
}

function argumentsRefusal(name: string, error: z.ZodError): string {
  return `not run: the arguments do not match ${name}'s schema:\n${z.prettifyError(error)}`;
}

const problemTexts: Readonly<Record<ArgumentsProblem, string>> = {
  not_json: "are not valid JSON",
  too_large: `are longer than ${String(maxArgumentsChars)} characters`,
  too_deep: `are nested deeper than ${String(maxArgumentsDepth)} levels`,
  duplicate_key: "name a field twice",
  unsafe_number:
    "hold an integer past 2^53 not written as plain digits; write amounts as decimal strings",
};

function unreadable(name: string, why: string): PreparedCall {
  return { ready: false, text: `not run: the arguments of ${name} ${why}` };
}

// A schema check that throws, a refinement written wrong for one, refuses the call instead.
function checked<Args>(
  args: z.ZodType<Args>,
  value: JsonValue,
): z.ZodSafeParseResult<Args> | undefined {
  try {
    return args.safeParse(value);
  } catch {
    return undefined;
  }
}

/**
 * Declares a tool (runtime spec, section 5.2). The model sees `z.toJSONSchema` of its arguments; a
 * call's arguments are parsed keeping integers past 2^53 exact, then checked with `safeParse`. A
 * call whose arguments are not JSON or do not pass never runs: the model reads the schema's issues
 * and may correct them. A result longer than 12,000 characters is cut.
 */
export function defineTool<Args>(spec: ToolSpec<Args>): AgentTool {
  if (!toolName.test(spec.name)) {
    throw invalidTool(spec.name, "its name is not lowercase words joined by underscores");
  }
  const declaration = {
    name: spec.name,
    description: spec.description,
    parameters: parametersOf(spec.name, spec.args),
  };
  if (spec.asksOwner === true && spec.kind !== "control") {
    throw invalidTool(spec.name, "a tool that asks the owner is not a control tool");
  }
  const ready = {
    ready: true as const,
    kind: spec.kind,
    outside: spec.outside === true,
    asksOwner: spec.asksOwner === true,
  };
  const parallel = spec.kind === "read" && spec.parallel === true;
  return {
    name: spec.name,
    declaration,
    prepare(argumentsText) {
      const json = parseArgumentsJson(argumentsText);
      if (!json.ok) {
        return unreadable(spec.name, problemTexts[json.error]);
      }
      const result = checked(spec.args, json.value);
      if (result === undefined) {
        return unreadable(spec.name, "could not be read");
      }
      if (!result.success) {
        return { ready: false, text: argumentsRefusal(spec.name, result.error) };
      }
      const args = result.data;
      const run = async (context: ToolRunContext): Promise<ToolOutcome> => {
        const outcome = await spec.run(args, context);
        return { ...outcome, text: cutResult(outcome.text) };
      };
      return { ...ready, parallel, run };
    },
  };
}
