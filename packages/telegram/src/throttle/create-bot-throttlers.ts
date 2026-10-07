import { BinferenceError } from "@binference/core";
import { sha256Hex } from "@binference/engine";
import type { Api, Transformer } from "grammy";
import { type BotThrottlerOptions, createBotThrottler } from "./create-bot-throttler.js";

/** The process's throttlers: one per bot token, shared by every grammY `Api` of that token. */
export interface BotThrottlers {
  /**
   * Installs the throttler of the Api's bot token on it; a second install on the same Api does
   * nothing. Throws `telegram.too_many_bots` past 16 tokens.
   */
  install(api: Api): void;
}

// An engine runs a bot or two; the bound refuses a runaway caller.
const maxTokens = 16;

/**
 * Creates the process's throttlers; the composition root makes one and installs it on every
 * `Api` it builds, before the first call. Tokens are held by their SHA-256, never as text.
 */
export function createBotThrottlers(options: BotThrottlerOptions): BotThrottlers {
  const throttlers = new Map<string, Transformer>();
  const throttled = new WeakSet<Api>();
  return {
    install: (api) => {
      if (throttled.has(api)) {
        return;
      }
      const key = sha256Hex(api.token);
      const throttler = throttlers.get(key) ?? createBotThrottler(options);
      if (!throttlers.has(key) && throttlers.size >= maxTokens) {
        throw new BinferenceError({
          code: "telegram.too_many_bots",
          message: `One process throttles at most ${String(maxTokens)} bot tokens.`,
        });
      }
      throttlers.set(key, throttler);
      throttled.add(api);
      api.config.use(throttler);
    },
  };
}
