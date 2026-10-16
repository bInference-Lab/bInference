import type { StartLine } from "../control/control-line.schema.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";

/** Settings with one provider and its key, as the engine sends them after reading its secrets. */
export const fixtureSettings: RuntimeSettings = {
  models: {
    providers: { router: { kind: "binference", apiKey: "sk-test-router" } },
    main: "router/main-model",
    fallbacks: { main: [], fast: [] },
    idleTimeoutMs: 120_000,
    cooldownMs: 60_000,
    maxToolCallsPerTurn: 25,
    loopDetection: true,
    imageInput: [],
    prices: {
      "router/main-model": {
        inputPerMTokUsd: 18_446_744_073_709_551_617n,
        outputPerMTokUsd: 2n,
        cachedPerMTokUsd: 0n,
      },
    },
  },
  chats: { newMessageMode: "merge" },
  search: { keys: {} },
  owner: { locale: "zh", timezone: "Asia/Shanghai" },
};

/** A start line for a token made of one repeated character, so each start can differ. */
export function fixtureStartLine(tokenChar = "a"): StartLine {
  return {
    t: "start",
    token: `bnt_${tokenChar.repeat(43)}`,
    endpoint: "/tmp/binference-test/engine.sock",
    paths: { agentDb: "/tmp/binference-test/agent.sqlite", workspace: "/tmp/binference-test/w" },
    settings: fixtureSettings,
  };
}
