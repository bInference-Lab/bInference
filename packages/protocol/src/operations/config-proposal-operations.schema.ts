import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type IntentView, intentViewSchema } from "../views/intent-view.schema.js";
import { type OperationTable, readFlags, writeFlags } from "./operation.schema.js";

/** A JSON object whose shape the config's owner, the CLI, gives it. */
type JsonObject = Readonly<Record<string, unknown>>;

/** What one key of the config takes, as the config reference words it in English. */
interface ConfigKeyRule {
  readonly path: string;
  /** What the key holds, such as "The model that makes images". */
  readonly description: string;
  /** What it takes, such as `a model as <provider>/<model>`. */
  readonly takes: string;
}

/**
 * The answer of `config/view` (decision 0393): the config, or the value of one key, every secret
 * source shown as its kind, with what each key under it takes, at most 200 of them.
 */
interface ConfigKeysView {
  readonly value?: unknown;
  readonly rules: readonly ConfigKeyRule[];
}

/** The args of `config/propose`: a JSON merge patch over `config.json5`, and why. */
interface ProposeConfigArgs {
  readonly patch: JsonObject;
  readonly reason?: string;
  /** The agent whose chat shows the card; the first active agent when absent. */
  readonly agent?: ProtocolId<"agent">;
}

/** The operations that read the config and propose a change of it with a card (decision 0393). */
export interface ConfigProposalOperationShapes {
  readonly "config/view": {
    readonly args: { readonly path?: string };
    readonly result: ConfigKeysView;
  };
  readonly "config/propose": { readonly args: ProposeConfigArgs; readonly result: IntentView };
}

/** The most characters of the reason a config change gives. */
const maxConfigReasonChars = 500;

const rule = z.object({ path: z.string(), description: z.string(), takes: z.string() });

/** The config proposal operations, by name. */
export const configProposalOperations: OperationTable<ConfigProposalOperationShapes> = {
  "config/view": {
    ...readFlags,
    name: "config/view",
    scope: "read",
    args: z.strictObject({ path: z.string().trim().min(1).max(200).exactOptional() }),
    result: z.object({
      value: z.unknown().exactOptional(),
      rules: z.array(rule).max(200).readonly(),
    }),
  },
  "config/propose": {
    ...writeFlags,
    name: "config/propose",
    scope: "propose",
    args: z.strictObject({
      patch: z.record(z.string(), z.unknown()),
      reason: z.string().trim().min(1).max(maxConfigReasonChars).exactOptional(),
      agent: protocolIdSchema("agent").exactOptional(),
    }),
    result: intentViewSchema,
  },
};
