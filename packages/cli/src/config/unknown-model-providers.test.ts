import { describe, expect, it } from "vitest";
import type { ModelsConfig } from "./schema/telegram-models.schema.js";
import { unknownModelProviders } from "./unknown-model-providers.js";

const models: ModelsConfig = {
  providers: { binference: { kind: "binference" }, claude: { kind: "anthropic" } },
  main: "binference/openai/gpt-5",
  imageInput: [],
  fallbacks: { main: [], fast: [] },
  idleTimeoutMs: 1,
  cooldownMs: 1,
  maxToolCallsPerTurn: 1,
  loopDetection: true,
  prices: {},
};

describe("models a change adds", () => {
  it("names one whose provider the config does not hold, and passes one it holds", () => {
    expect([
      unknownModelProviders(models, { ...models, imageMaking: "openai/gpt-image-1" }),
      unknownModelProviders(models, { ...models, imageMaking: "binference/openai/gpt-image-1" }),
    ]).toStrictEqual([["openai/gpt-image-1"], []]);
  });

  it("names an image model on a provider that cannot make images", () => {
    expect(unknownModelProviders(models, { ...models, imageMaking: "claude/opus" })).toStrictEqual([
      "claude/opus",
    ]);
  });

  it("names a video model off the gateway and a speech model off an openai provider", () => {
    const oa = { kind: "openai" } as const;
    const withOpenai: ModelsConfig = { ...models, providers: { ...models.providers, oa } };
    expect([
      unknownModelProviders(withOpenai, { ...withOpenai, videoMaking: "oa/sora" }),
      unknownModelProviders(withOpenai, { ...withOpenai, videoMaking: "binference/alibaba/wan" }),
      unknownModelProviders(withOpenai, { ...withOpenai, speech: "binference/openai/tts" }),
      unknownModelProviders(withOpenai, { ...withOpenai, speech: "oa/gpt-4o-mini-tts" }),
      unknownModelProviders(withOpenai, { ...withOpenai, speech: "local" }),
      unknownModelProviders(withOpenai, { ...withOpenai, speech: "none/tts" }),
    ]).toStrictEqual([["oa/sora"], [], ["binference/openai/tts"], [], [], ["none/tts"]]);
  });

  it("leaves a model the config named before, so an older file takes other changes", () => {
    const dangling = { ...models, fast: "gone/model" };
    expect(unknownModelProviders(dangling, { ...dangling, cooldownMs: 2 })).toStrictEqual([]);
  });
});
