import { err, ok, type Result } from "@binference/core";
import { IntlMessageFormat } from "intl-messageformat";

/** A readonly view of one node of the message tree FormatJS parses. */
interface MessageNode {
  readonly type: number;
  readonly value?: string;
  readonly options?: Readonly<Record<string, { readonly value: readonly MessageNode[] }>>;
  readonly children?: readonly MessageNode[];
  readonly pluralType?: string | undefined;
}

/** What the checks read from one message. */
export interface ParsedMessage {
  /** Each argument once, sorted, as `{name}`, `{name, number}`, `{name, plural}` or `<name>`. */
  readonly arguments: readonly string[];
  /** The words around the arguments, plural and select branches included, one piece a line. */
  readonly text: string;
}

// FormatJS numbers its node types; these numbers are part of its published message tree.
const literalType = 0;
const argumentForms: ReadonlyMap<number, string> = new Map([
  [1, "{%}"],
  [2, "{%, number}"],
  [3, "{%, date}"],
  [4, "{%, time}"],
  [5, "{%, select}"],
  [6, "{%, plural}"],
  [8, "<%>"],
]);

function argumentOf(node: MessageNode): readonly string[] {
  const form = node.pluralType === "ordinal" ? "{%, selectordinal}" : argumentForms.get(node.type);
  return form === undefined || node.value === undefined ? [] : [form.replace("%", node.value)];
}

function childrenOf(node: MessageNode): readonly MessageNode[] {
  const branches = Object.values(node.options ?? {}).flatMap((option) => option.value);
  return [...(node.children ?? []), ...branches];
}

function argumentsIn(nodes: readonly MessageNode[]): readonly string[] {
  return nodes.flatMap((node) => [...argumentOf(node), ...argumentsIn(childrenOf(node))]);
}

function textIn(nodes: readonly MessageNode[]): readonly string[] {
  return nodes.flatMap((node) =>
    node.type === literalType && node.value !== undefined ? [node.value] : textIn(childrenOf(node)),
  );
}

function treeOf(text: string): Result<readonly MessageNode[], string> {
  try {
    return ok(new IntlMessageFormat(text, "en-US").getAst());
  } catch (error) {
    return err(error instanceof Error ? error.message : "unreadable");
  }
}

/**
 * Parses an ICU message into its arguments and its words. The error side holds the parser's own
 * words, such as `EXPECT_ARGUMENT_CLOSING_BRACE`.
 */
export function parseMessage(text: string): Result<ParsedMessage, string> {
  const tree = treeOf(text);
  if (!tree.ok) {
    return tree;
  }
  const names = [...new Set(argumentsIn(tree.value))].toSorted();
  return ok({ arguments: names, text: textIn(tree.value).join("\n") });
}
