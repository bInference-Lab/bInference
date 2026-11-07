import { type JsonValue, jsonValueSchema } from "@binference/core";
import type { IntentView } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `settings_read` takes: a dotted key, or none for the whole config. */
interface SettingsReadArgs {
  readonly key?: string;
}

/** One key `settings_change` sets, or removes with `null`, so its default applies. */
interface SettingChange {
  readonly key: string;
  readonly value: JsonValue;
}

/** What `settings_change` takes: the keys it changes, and why, for the owner's card. */
interface SettingsChangeArgs {
  readonly changes: readonly SettingChange[];
  readonly reason: string;
  /** The `hash` settings_read answered; a file changed since is refused. */
  readonly baseHash: string;
  /** Lists whose entries the change means to drop. */
  readonly replace?: readonly string[];
}

const keySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u)
  .max(200);

const readArgs: z.ZodType<SettingsReadArgs> = z.strictObject({ key: keySchema.exactOptional() });

const changeArgs: z.ZodType<SettingsChangeArgs> = z.strictObject({
  changes: z
    .array(z.strictObject({ key: keySchema, value: jsonValueSchema }))
    .min(1)
    .max(20),
  reason: z.string().trim().min(1).max(500),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/u),
  replace: z.array(keySchema).max(64).exactOptional(),
});

/** A JSON merge patch: each key's value, or a group of keys. */
interface Patch {
  readonly [key: string]: JsonValue;
}

// Each dotted key set into one merge patch: `a.b` and `a.c` share the group `a`.
function patchOf(changes: readonly SettingChange[]): Patch {
  return changes.reduce<Patch>(
    (patch, { key, value }) => withKey(patch, key.split("."), value),
    {},
  );
}

function isGroup(value: JsonValue | undefined): value is Patch {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withKey(patch: Patch, keys: readonly string[], value: JsonValue): Patch {
  const [first = "", ...rest] = keys;
  if (rest.length === 0) {
    return { ...patch, [first]: value };
  }
  const inner = patch[first];
  return { ...patch, [first]: withKey(isGroup(inner) ? inner : {}, rest, value) };
}

const unread = "nothing was read:";
const unproposed = "nothing was proposed and nothing changed:";

const readRefusals: Readonly<Record<string, string>> = {
  "protocol.bad_args": `${unread} that key is not in the config. Read the whole config or a group above it to find the key.`,
};

const changeRefusals: Readonly<Record<string, string>> = {
  "config.invalid": `${unproposed} the config would fail its checks with these values, or a model names a provider that models.providers does not hold. Read the key and models with settings_read, then propose values it accepts.`,
  "config.secret_inline": `${unproposed} a secret's value never goes in the config or a chat. Ask the owner for it with credentials, then set the key to { "fromCredential": "<NAME>" }.`,
  "config.secret_unreadable": `${unproposed} a secret the change names is not there to read. Check credentials with action list; ask the owner for a missing one with action request and wait for it, then propose the change again.`,
  "protocol.bad_args": `${unproposed} the change sets nothing new, or more than 20 keys. Read the keys first and propose only what differs.`,
  "auth.scope": `${unproposed} this caller may not propose a settings change.`,
  "config.changed": `${unproposed} the settings changed since you read them. Read them again with settings_read and propose the change with its new hash.`,
  "config.list_shrinks": `${unproposed} the change drops entries from a list. Add to the list instead, or name it in replace when the owner asked to drop them.`,
};

function proposedText(view: IntentView): string {
  return `Proposed as intent ${view.intent}: the owner's card shows each key before and after, and nothing changes until they tap Confirm. The turn ends here; their answer starts your next turn.`;
}

/**
 * `settings_read`, a read tool (decision 0393): the config the engine runs with, or one dotted
 * key, every secret shown as its kind, with the rules of the keys under it. The engine and the
 * owner wrote it, so the answer is never outside content.
 */
export function settingsReadTool({ client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "settings_read",
    kind: "read",
    description: agentToolTexts.settings_read,
    args: readArgs,
    run: async ({ key }, { signal }) =>
      answerOrRefusal({ tool: "settings_read", refusals: readRefusals }, async () => {
        const viewed = await client.call("config/view", key === undefined ? {} : { path: key }, {
          signal,
        });
        return { text: JSON.stringify(viewed), isError: false };
      }),
  });
}

/**
 * `settings_change`, a propose tool (decision 0393): proposes setting or removing config keys in
 * one card the owner confirms, with the agent's reason; nothing changes before the tap, and the
 * turn ends with it, as every proposal's does.
 */
export function settingsChangeTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "settings_change",
    kind: "propose",
    description: agentToolTexts.settings_change,
    args: changeArgs,
    run: async ({ changes, reason, baseHash, replace }, { signal, idempotencyKey }) =>
      answerOrRefusal({ tool: "settings_change", refusals: changeRefusals }, async () => {
        const replaced = replace === undefined ? {} : { replacePaths: replace };
        const proposal = { patch: patchOf(changes), reason, agent, baseHash, ...replaced };
        const view = await client.call("config/propose", proposal, { signal, key: idempotencyKey });
        return { text: proposedText(view), isError: false };
      }),
  });
}
