import { describe, expect, it } from "vitest";
import { addedSecretSources } from "./added-secret-sources.js";
import type { BinferenceConfig } from "./schema/config.schema.js";

// Only the keys the finder walks; the rest of a config adds no secret source.
const config = (telegram: object) => ({ telegram }) as unknown as BinferenceConfig;

describe("the secret sources a change adds", () => {
  it("names a new or changed source by its key, and leaves one that stayed", () => {
    const before = config({ botToken: { fromEnv: "OLD" } });
    expect([
      addedSecretSources(before, config({ botToken: { fromEnv: "NEW" } })),
      addedSecretSources(before, before),
    ]).toStrictEqual([[{ path: "telegram.botToken", source: { fromEnv: "NEW" } }], []]);
  });

  it("leaves out a program's source, which only runs after the owner's tap", () => {
    const after = config({ botToken: { fromCommand: ["op", "read", "op://bot"] } });
    expect(addedSecretSources(config({}), after)).toStrictEqual([]);
  });
});
