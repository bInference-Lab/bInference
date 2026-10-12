import { describe, expect, it } from "vitest";
import { mergeSourceContract } from "../contracts/merge-source-contract.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createQueueMerge } from "./queue-merge.js";
import { payloadOf } from "./queued-view.js";

const agent = nthTestId("agt", 1);
const session = nthTestId("ses", 1);
const live = (): AbortSignal => new AbortController().signal;

describe("createQueueMerge", () => {
  it.each(
    mergeSourceContract({
      create: async ({ mode }) => {
        const { stores } = await createMemoryAgentStores();
        const merge = createQueueMerge({
          stores,
          session,
          turn: nthTestId("trn", 1),
          mode: () => mode,
          serial: async (work) => work(),
        });
        const added: string[] = [];
        return {
          merge,
          async wait(count) {
            const ids = Array.from({ length: count }, (_, index) =>
              nthTestId("msg", added.length + index + 1),
            );
            for (const [index, message] of ids.entries()) {
              const view = {
                kind: "inbox/message" as const,
                message,
                agent,
                session,
                at: 1,
                turn: nthTestId("trn", 100 + index),
                text: `message ${String(index)}`,
                surface: "cli" as const,
              };
              const draft = { message, agentId: agent, sessionId: session, kind: view.kind };
              // oxlint-disable-next-line eslint/no-await-in-loop -- they arrive in order
              await stores.queue.add(
                {
                  ...draft,
                  payload: payloadOf(view),
                  receivedAtMs: added.length + index,
                  fence: stores.fence,
                },
                { signal: live() },
              );
            }
            added.push(...ids);
            return ids;
          },
          waiting: async () =>
            (
              await stores.queue.waiting({ sessionId: session, limit: 200 }, { signal: live() })
            ).map((message) => message.message),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
