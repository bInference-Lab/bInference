import { accountRefSchema, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryInstallStore } from "../fakes/memory-install-store.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import { createAgentListHandlers } from "./agent-list-handlers.js";
import { testCall } from "./test-engine.js";

const second = fixtureId("agt", 51);
const third = fixtureId("agt", 52);
const archived = testWalletRecord({
  id: fixtureId("wal", 51),
  agentId: testAgent,
  label: "Old",
  createdAtMs: 5,
  archivedAtMs: 6,
});
const main = testWalletRecord({
  id: fixtureId("wal", 52),
  agentId: testAgent,
  label: "Main",
  createdAtMs: 10,
});
const spare = testWalletRecord({
  id: fixtureId("wal", 53),
  agentId: testAgent,
  label: "Spare",
  createdAtMs: 20,
});
const unheld = testWalletRecord({
  id: fixtureId("wal", 54),
  agentId: second,
  label: "Unheld",
  createdAtMs: 30,
});
const address = accountRefSchema.parse("fake:1:0x00000052");

async function agentList() {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), testCall({}));
  await agents.create(
    testAgentDraft({ id: second, name: "second", mode: "live", atMs: testNowMs }),
    testCall({}),
  );
  await agents.create(
    testAgentDraft({ id: third, name: "third", atMs: testNowMs + 1 }),
    testCall({}),
  );
  const install = createMemoryInstallStore();
  [archived, main, spare, unheld].forEach((wallet) => install.addWallet(wallet));
  const chains = createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  const custody = createFakeSigner(new Map([[main.id, address]]));
  return createAgentListHandlers({ agents, install, custody, chains })["agent/list"];
}

describe("the agent list", () => {
  it("lists every agent oldest first, each with its oldest wallet not archived", async () => {
    const list = await agentList();
    const { items, next } = expectOk(await list(testCall({})));
    expect(next).toBeUndefined();
    expect(items.map((view) => [view.agent, view.name, view.mode])).toStrictEqual([
      [testAgent, "main", "paper"],
      [second, "second", "live"],
      [third, "third", "paper"],
    ]);
    expect(items[0]?.defaultWallet).toStrictEqual({
      wallet: main.id,
      agent: testAgent,
      address,
      label: "Main",
      createdAt: 10,
    });
  });

  it("leaves the default wallet out of an agent with none, or one custody does not hold", async () => {
    const list = await agentList();
    const { items } = expectOk(await list(testCall({})));
    expect(items.slice(1).map((view) => "defaultWallet" in view)).toStrictEqual([false, false]);
  });

  it("pages from the last agent of the page before", async () => {
    const list = await agentList();
    const first = expectOk(await list(testCall({ limit: 2 })));
    expect(first.items.map((view) => view.agent)).toStrictEqual([testAgent, second]);
    expect(first.next).toBe(second);
    const rest = expectOk(await list(testCall({ cursor: second, limit: 2 })));
    expect(rest).toStrictEqual({ items: [expect.objectContaining({ agent: third })] });
  });

  it("refuses a cursor that names no agent", async () => {
    const list = await agentList();
    await expect(list(testCall({ cursor: fixtureId("agt", 59) }))).resolves.toStrictEqual(
      err("protocol.bad_args"),
    );
  });
});
