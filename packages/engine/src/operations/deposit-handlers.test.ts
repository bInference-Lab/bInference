import { err, ok } from "@binference/core";
import type { WalletView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createDepositHandlers } from "./deposit-handlers.js";
import type { EngineHandler } from "./engine-call.js";
import { testCall } from "./test-engine.js";

const turn = fixtureId("trn", 1);

function walletOf(n: number, marks: Partial<WalletView> = {}): WalletView {
  return {
    wallet: fixtureId("wal", n),
    agent: testAgent,
    address: `fake:1:0x000000${String(n)}` as WalletView["address"],
    label: `Wallet ${String(n)}`,
    createdAt: n,
    ...marks,
  };
}

const main = walletOf(10);
const launch = walletOf(11, { role: "launch" });
const old = walletOf(12, { archivedAt: 20 });
const spare = walletOf(13, { bridge: true, extra: true });
const onlyMain: EngineHandler<"wallet/list"> = async () => Promise.resolve(ok({ items: [main] }));

async function deposits(
  items: readonly WalletView[],
  draft: Parameters<typeof testAgentDraft>[0] = {},
) {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(draft), testCall({}));
  const pushes: EnginePush[] = [];
  const listWallets: EngineHandler<"wallet/list"> = async () => Promise.resolve(ok({ items }));
  const handlers = createDepositHandlers({
    agents,
    listWallets,
    publish: (push) => pushes.push(push),
  });
  return { deposit: handlers["turn/deposit"], pushes };
}

describe("the deposit the agent shows", () => {
  it("pushes every wallet the agent runs from on its chat topic, with its mode and freeze", async () => {
    const { deposit, pushes } = await deposits([main, launch, old, spare]);
    const shown = expectOk(await deposit(testCall({ agent: testAgent, turn })));
    expect(shown.wallets.map((view) => view.wallet)).toStrictEqual([main.wallet, launch.wallet]);
    expect(pushes).toStrictEqual([
      {
        topic: `chat:${testAgent}`,
        kind: "chat/deposit",
        data: {
          agent: testAgent,
          turn,
          mode: "paper",
          frozen: false,
          wallets: [
            expect.objectContaining({ wallet: main.wallet, address: main.address }),
            expect.objectContaining({ wallet: launch.wallet, role: "launch" }),
          ],
        },
      },
    ]);
  });

  it("marks the push while the breaker holds the agent, which no unfreeze lifts", async () => {
    const install = { frozenAt: () => undefined, breakerMark: { at: () => 5 } };
    const agents = createMemoryAgentStore({ install });
    await agents.create(testAgentDraft({}), testCall({}));
    const pushes: EnginePush[] = [];
    const listWallets = onlyMain;
    const handlers = createDepositHandlers({ agents, listWallets, publish: (p) => pushes.push(p) });
    expectOk(await handlers["turn/deposit"](testCall({ agent: testAgent, turn })));
    expect(pushes[0]?.data).toMatchObject({ frozen: true, breaker: true });
  });

  it("shows only the wallet the call names", async () => {
    const { deposit } = await deposits([main, launch]);
    const shown = expectOk(
      await deposit(testCall({ agent: testAgent, turn, wallet: launch.wallet })),
    );
    expect(shown.wallets.map((view) => view.wallet)).toStrictEqual([launch.wallet]);
  });

  it("refuses an extra wallet, an archived one, and an agent with none, and pushes nothing", async () => {
    const { deposit, pushes } = await deposits([old, spare]);
    await expect(deposit(testCall({ agent: testAgent, turn }))).resolves.toStrictEqual(
      err("wallet.not_found"),
    );
    await expect(
      deposit(testCall({ agent: testAgent, turn, wallet: spare.wallet })),
    ).resolves.toStrictEqual(err("wallet.not_found"));
    expect(pushes).toStrictEqual([]);
  });

  it("refuses an agent the install does not hold", async () => {
    const { deposit } = await deposits([main]);
    await expect(deposit(testCall({ agent: fixtureId("agt", 59), turn }))).resolves.toStrictEqual(
      err("agent.not_found"),
    );
  });
});
