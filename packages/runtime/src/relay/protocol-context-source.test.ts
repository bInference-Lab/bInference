import { BinferenceError } from "@binference/core";
import { liveFactsViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { contextSourceContract } from "../contracts/context-source-contract.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import {
  createMemoryContextSource,
  type MemoryContextSource,
} from "../testing/memory-context-source.js";
import { createProtocolContextSource } from "./protocol-context-source.js";

const agent = nthTestId("agt", 1);
const rules = "# Rules\nNever buy a token with a tax above 10%.\n";

// A protocol client over the fake source, each answer as the engine sends it on the wire: a
// missing file fails with `agent.file_missing`, and the facts travel as JSON.
function clientOver(source: MemoryContextSource) {
  return {
    call: async (op: string, args: Record<string, unknown>, options: { signal: AbortSignal }) => {
      const place = { agent: args["agent"], file: args["file"] } as never;
      if (op === "agent/readFile") {
        const text = await source.workspaceFile(place, options.signal);
        if (text === undefined) {
          throw new BinferenceError({ code: "agent.file_missing", message: "No such file." });
        }
        return { text, updatedAt: 1 };
      }
      const facts = await source.liveFacts(args["agent"] as never, options.signal);
      const text = JSON.stringify(facts, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      return liveFactsViewSchema.parse(JSON.parse(text) as object);
    },
  } as never;
}

describe("createProtocolContextSource", () => {
  it.each(
    contextSourceContract({
      create: async () => {
        const memory = createMemoryContextSource({ agents: [agent] });
        memory.write(agent, "RULES.md", rules);
        const source = createProtocolContextSource(clientOver(memory));
        return await Promise.resolve({ source, agent, unknownAgent: nthTestId("agt", 9), rules });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes on a failure other than a missing file", async () => {
    const source = createProtocolContextSource({
      call: async () => {
        throw new BinferenceError({ code: "engine.stopping", message: "Stopping." });
      },
    } as never);
    await expect(
      source.workspaceFile({ agent, file: "RULES.md" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "engine.stopping" });
  });
});
