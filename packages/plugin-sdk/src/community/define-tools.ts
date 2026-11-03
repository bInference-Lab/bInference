import { BinferenceError, type JsonValue } from "@binference/core";

/** A request a community plugin asks the plugin host to fetch for it. */
export interface PluginFetchRequest {
  /** An `https` URL on one of the plugin's declared hosts. */
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  /** A body of at most 1 MiB, for a `POST`. */
  readonly body?: string;
}

/** What the plugin host fetched: the status, the headers and the body as text, at most 1 MiB. */
export interface PluginFetchAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What one tool call gets besides its input. */
export interface ToolCallContext {
  /** The plugin's settings, `plugins.<id>` in `config.json5`, as its config schema read them. */
  readonly config: JsonValue;
  /**
   * The one folder the plugin may write, by its absolute path. The plugin runs in its own package
   * folder, which it may only read.
   */
  readonly dataFolder: string;
  /** Aborts when the call's 30 seconds run out or the plugin stops. */
  readonly signal: AbortSignal;
  /**
   * Fetches through the plugin host, the plugin's only way out: an `https` URL on a declared
   * host, answered in 15 seconds with at most 1 MiB. Another host is refused
   * (`plugin.host_refused`) and the owner is told. The plugin's own `fetch`, sockets and DNS are
   * refused by Node.
   */
  fetch(request: PluginFetchRequest): Promise<PluginFetchAnswer>;
}

/** One tool's body: its input as its declared input schema read it, and its answer as JSON. */
export type ToolRun = (input: JsonValue, context: ToolCallContext) => Promise<JsonValue>;

/** A community plugin's tools by name, as its entry module exports them as `tools`. */
export type CommunityTools = Readonly<Record<string, ToolRun>>;

const toolNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Defines a community plugin's tools, which its entry module exports as `tools`. Each name must be
 * one its manifest declares, and the plugin host refuses a plugin whose tools differ from the
 * manifest's. A name that is not 1 to 64 of `[a-z0-9_]` starting with a letter, or a body that is
 * not a function, is a fault (`plugin.bad_tools`) when the plugin loads. The tools are frozen.
 */
export function defineTools(tools: CommunityTools): CommunityTools {
  for (const [name, run] of Object.entries(tools)) {
    if (!toolNamePattern.test(name) || typeof run !== "function") {
      throw new BinferenceError({
        code: "plugin.bad_tools",
        message: `The tool ${name} is declared wrong: a name of [a-z0-9_] and a function body.`,
      });
    }
  }
  return Object.freeze({ ...tools });
}
