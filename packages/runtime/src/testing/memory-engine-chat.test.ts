import { describe, expect, it } from "vitest";
import { engineChatContract } from "../contracts/engine-chat-contract.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryEngineChat } from "./memory-engine-chat.js";

const agent = nthTestId("agt", 1);

describe("createMemoryEngineChat", () => {
  it.each(
    engineChatContract({
      create: async () => {
        const chat = createMemoryEngineChat([agent]);
        return {
          chat,
          agent,
          unknownAgent: nthTestId("agt", 9),
          post: async (text) => chat.post(agent, text),
          stop: async () => {
            chat.stop(agent);
          },
          clear: async () => chat.clear(agent),
          chatSeen: async () => chat.pushes.map((push) => push.kind),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
