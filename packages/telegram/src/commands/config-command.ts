import type { JsonValue } from "@binference/core";
import { callOrSay, type CommandContext } from "./command-context.js";
import { typedValueOf } from "./typed-value.schema.js";

/** The most key rules one `/config <key>` lists, so the reply stays readable on a phone. */
const maxRulesShown = 20;

/** A JSON merge patch: each key's value, or a group of keys. */
interface PatchObject {
  readonly [key: string]: JsonValue;
}

const keyPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;

// The JSON merge patch that sets one dotted key: `a.b` and 5 give `{ a: { b: 5 } }`.
function patchOf(keys: readonly string[], value: JsonValue): PatchObject {
  const [first = "", ...rest] = keys;
  return { [first]: rest.length === 0 ? value : patchOf(rest, value) };
}

async function show(context: CommandContext, path: string | undefined): Promise<void> {
  const viewed = await callOrSay(context, "config/view", path === undefined ? {} : { path });
  if (viewed === undefined) {
    return;
  }
  const value = JSON.stringify(viewed.value ?? null, null, 2);
  const rules = viewed.rules
    .slice(0, maxRulesShown)
    .map((rule) => context.words("cmd.config.rule", { ...rule }));
  const more = viewed.rules.length - rules.length;
  const tail = more > 0 ? [context.words("cmd.config.more", { count: more })] : [];
  const heading = context.words("cmd.config.value", { path: path ?? "config.json5" });
  await context.say([heading, value, "", ...rules, ...tail].join("\n"));
}

async function propose(context: CommandContext, path: string, value: JsonValue): Promise<void> {
  if (!keyPattern.test(path)) {
    await context.say(context.words("cmd.config.usage"));
    return;
  }
  // The owner typed the whole value, so a list they set or unset is replaced as typed.
  const patch = patchOf(path.split("."), value);
  const proposed = await callOrSay(context, "config/propose", { patch, replacePaths: [path] });
  if (proposed === undefined) {
    return;
  }
  const { signal } = context;
  const card = (await context.waiting({ signal })).find((open) => open.intent === proposed.intent);
  const shown = card === undefined ? undefined : await context.cards.show(card, { signal });
  const replyTo = shown?.ok === true ? { replyTo: shown.value.messageId } : {};
  await context.say(context.words("cmd.config.waiting"), replyTo);
}

// `set <key> <value>` sets the key, `unset <key>` removes it so its default applies.
function changeOf(
  verb: string,
  path: string,
  rest: readonly string[],
): { readonly value: JsonValue } | undefined {
  if (path === "") {
    return undefined;
  }
  if (verb === "set" && rest.length > 0) {
    return { value: typedValueOf(rest.join(" ")) };
  }
  return verb === "unset" && rest.length === 0 ? { value: null } : undefined;
}

/**
 * `/config`: reads and changes the agent's settings from the chat (decision 0393). Alone it shows
 * the config with every secret as its kind; `/config <key>` one key and the rules of the keys
 * under it; `/config set <key> <value>` and `/config unset <key>` open a card for the change,
 * which applies only on the owner's tap. A value that reads as JSON is taken as JSON, any other
 * as text; a secret's value is refused, since a chat never carries one.
 */
export async function runConfig(context: CommandContext): Promise<void> {
  const [verb = "", path = "", ...rest] = context.args.split(/\s+/u).filter((word) => word !== "");
  const change = changeOf(verb, path, rest);
  if (change !== undefined) {
    await propose(context, path, change.value);
    return;
  }
  const isRead = verb === "" || (keyPattern.test(verb) && path === "");
  if (isRead) {
    await show(context, verb === "" ? undefined : verb);
    return;
  }
  await context.say(context.words("cmd.config.usage"));
}

/**
 * `/restart`: restarts binference for the owner (decision 0395). It stops through its shutdown
 * sequence and starts again, then tells the owner here that it serves again.
 */
export async function runRestart(context: CommandContext): Promise<void> {
  if ((await callOrSay(context, "engine/restart", {})) !== undefined) {
    await context.say(context.words("cmd.restart.started"));
  }
}
