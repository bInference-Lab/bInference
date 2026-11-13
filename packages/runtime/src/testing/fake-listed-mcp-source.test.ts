import { describe, expect, it } from "vitest";
import { listedMcpSourceContract } from "../contracts/listed-mcp-source-contract.js";
import { createFakeListedMcpSource } from "./fake-listed-mcp-source.js";
import { listedServerFixture } from "./listing-fixture.js";
import { nthTestId } from "./memory-agent-stores.js";

describe("createFakeListedMcpSource", () => {
  it.each(
    listedMcpSourceContract(
      {
        create: async (initial) => {
          const source = createFakeListedMcpSource(initial);
          return {
            source,
            change: async (next) => {
              source.set(next);
              return Promise.resolve();
            },
          };
        },
      },
      [listedServerFixture([nthTestId("agt", 1)])],
    ),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
