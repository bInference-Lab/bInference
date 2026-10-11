import { BinferenceError, type Logger } from "@binference/core";
import type { RuntimeProvider, RuntimeSettings } from "@binference/runtime";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

type RuntimeConfig = Pick<BinferenceConfig, "models" | "chats" | "search" | "owner">;

interface ReadCall {
  readonly secrets: SecretReader;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

// One key's text, or none when the config names none or its source has none: the runtime then
// calls without it, and the provider's refusal names the key.
async function keyOf(
  path: string,
  source: SecretSource | undefined,
  call: ReadCall,
): Promise<{ readonly key?: string }> {
  if (source === undefined) {
    return {};
  }
  try {
    return { key: (await call.secrets.read(path, source, call.signal)).reveal() };
  } catch (error) {
    call.signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    call.logger.warn("runtime.key_unread", { errorCode });
    return {};
  }
}

async function providersOf(
  config: RuntimeConfig,
  call: ReadCall,
): Promise<Readonly<Record<string, RuntimeProvider>>> {
  const entries = await Promise.all(
    Object.entries(config.models.providers).map(async ([name, provider]) => {
      const { key } = await keyOf(`models.providers.${name}.apiKey`, provider.apiKey, call);
      const runtime: RuntimeProvider = {
        kind: provider.kind,
        ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
        ...(key === undefined ? {} : { apiKey: key }),
      };
      return [name, runtime] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function searchOf(config: RuntimeConfig, call: ReadCall): Promise<RuntimeSettings["search"]> {
  const { provider, keys, xApiKey } = config.search;
  const [brave, tavily, x] = await Promise.all([
    keyOf("search.keys.brave", keys.brave, call),
    keyOf("search.keys.tavily", keys.tavily, call),
    keyOf("search.xApiKey", xApiKey, call),
  ]);
  return {
    provider,
    keys: {
      ...(brave.key === undefined ? {} : { brave: brave.key }),
      ...(tavily.key === undefined ? {} : { tavily: tavily.key }),
    },
    ...(x.key === undefined ? {} : { xApiKey: x.key }),
  };
}

/**
 * The settings the runtime starts with (runtime spec, section 2.2): the models with each
 * provider's key read from its secret source, the chat mode, the search provider with its keys,
 * and the owner's language and time zone. A key that cannot be read is logged with its code and
 * left out; the runtime starts without it.
 */
export async function runtimeSettingsOf(
  config: RuntimeConfig,
  call: ReadCall,
): Promise<RuntimeSettings> {
  const [providers, search] = await Promise.all([
    providersOf(config, call),
    searchOf(config, call),
  ]);
  return {
    models: { ...config.models, providers },
    chats: { newMessageMode: config.chats.newMessageMode },
    search,
    owner: { locale: config.owner.locale, timezone: config.owner.timezone },
  };
}
