import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import { createRecordedHttp } from "../testing/recorded-http.js";
import { turnModelsOf } from "./turn-models.js";

const clock: Clock = { now: () => 0, sleep: async () => Promise.resolve() };
const parts = { http: createRecordedHttp([]), clock, rests: new Map<string, number>() };

const models: RuntimeModels = {
  providers: { router: { kind: "binference" } },
  main: "router/main",
  fast: "router/fast",
  fallbacks: { main: ["router/backup"], fast: ["router/fast-backup"] },
  idleTimeoutMs: 120_000,
  cooldownMs: 60_000,
  maxToolCallsPerTurn: 25,
  loopDetection: true,
  imageInput: [],
  prices: {},
  picked: {
    agt_picked: { main: "router/picked" },
    agt_fast: { fast: "router/backup" },
    agt_eyes: { vision: "router/eyes" },
  },
};

function namesOf(agent: string, settings: RuntimeModels = models) {
  const { main, summarizer } = turnModelsOf(agent, { models: settings }, parts);
  return {
    main: main.models.map((model) => model.name),
    summarizer: summarizer.models.map((model) => model.name),
  };
}

describe("turnModelsOf", () => {
  it("runs an agent the owner picked no model for on the config's models and fallbacks", () => {
    expect(namesOf("agt_other")).toStrictEqual({
      main: ["router/main", "router/backup"],
      summarizer: ["router/fast", "router/fast-backup"],
    });
  });

  it("runs the picked model alone, never swapped for a fallback", () => {
    expect(namesOf("agt_picked")).toStrictEqual({
      main: ["router/picked"],
      summarizer: ["router/fast", "router/fast-backup"],
    });
    expect(namesOf("agt_fast").summarizer).toStrictEqual(["router/backup"]);
  });

  it("summarizes on the main model and its pick when no fast model is set", () => {
    const { fast: _fast, ...noFast } = models;
    expect(namesOf("agt_picked", noFast)).toStrictEqual({
      main: ["router/picked"],
      summarizer: ["router/picked"],
    });
  });

  it("reads images on the models imageInput names, and on the vision model by its role", () => {
    const declared = { ...models, imageInput: ["router/backup"], vision: "router/vision" };
    const { main, vision } = turnModelsOf("agt_other", { models: declared }, parts);
    expect(main.models.map((model) => model.readsImages === true)).toStrictEqual([false, true]);
    expect(vision?.models.map((model) => [model.name, model.readsImages])).toStrictEqual([
      ["router/vision", true],
    ]);
    const picked = turnModelsOf("agt_eyes", { models: declared }, parts).vision;
    expect(picked?.models.map((model) => model.name)).toStrictEqual(["router/eyes"]);
  });

  it("has no vision model when neither the config nor the agent's pick names one", () => {
    expect(turnModelsOf("agt_other", { models }, parts).vision).toBeUndefined();
  });
});
