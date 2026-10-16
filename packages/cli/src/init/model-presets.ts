import type { ProviderKind } from "../config/schema/telegram-models.schema.js";

/** A model provider init offers: its name in `models.providers`, its wire format and address. */
export interface ModelPreset {
  /** The option's value. */
  readonly id: string;
  /** The provider's name in `models.providers`. */
  readonly name: string;
  readonly kind: ProviderKind;
  /**
   * The address init writes as `baseUrl`. None for a provider at the API its kind calls by
   * default, and for one whose address the owner types.
   */
  readonly baseUrl?: string;
  /** The owner types the address: any other compatible provider, local ones included. */
  readonly asksBaseUrl: boolean;
}

/**
 * The providers init offers, in the order of the choice (decision 0221): the bInference Router,
 * OpenAI, Anthropic and OpenRouter at their documented APIs, then any other provider that speaks
 * Chat Completions or Messages at the address the owner types.
 */
export const modelPresets: readonly ModelPreset[] = [
  { id: "binference", name: "binference", kind: "binference", asksBaseUrl: false },
  { id: "openai", name: "openai", kind: "openai", asksBaseUrl: false },
  { id: "anthropic", name: "anthropic", kind: "anthropic", asksBaseUrl: false },
  {
    id: "openrouter",
    name: "openrouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    asksBaseUrl: false,
  },
  { id: "openai-compatible", name: "compatible", kind: "openai", asksBaseUrl: true },
  { id: "anthropic-compatible", name: "compatible", kind: "anthropic", asksBaseUrl: true },
];

/**
 * The preset a provider of the config stands for: the one of its name and wire format, else the
 * compatible one of its wire format, which takes its address.
 */
export function modelPresetOf(provider: {
  readonly name: string;
  readonly kind: ProviderKind;
}): ModelPreset | undefined {
  const named = modelPresets.find(
    (preset) => preset.name === provider.name && preset.kind === provider.kind,
  );
  return (
    named ?? modelPresets.find((preset) => preset.asksBaseUrl && preset.kind === provider.kind)
  );
}

/** Whether an address is one a provider may be called at: https, or http on this machine. */
export function isModelAddress(text: string): boolean {
  if (!URL.canParse(text)) {
    return false;
  }
  const url = new URL(text);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return url.protocol === "https:" || (url.protocol === "http:" && isLocal);
}

/** A model's id as a provider names it: no spaces, at most 200 characters. */
export const modelIdPattern: RegExp = /^\S{1,200}$/;
