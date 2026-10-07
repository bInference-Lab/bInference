import { createServer as createNetServer, type Server as NetServer } from "node:net";
import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  createChainRegistry,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeVenue,
} from "@binference/chain/testing";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { bpsSchema, type Id, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import {
  type LimitsValues,
  type PositionStore,
  sha256Hex,
  walkLedgerChain,
} from "@binference/engine";
import {
  createFakeExecutor,
  createFakePriceSource,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
  createQuoteSimulator,
  type FakeExecutor,
} from "@binference/engine/testing";
import { operations, type PushFrame } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { composeCloudTestRoot } from "./cloud-test-root.js";
import { composeEngine, type EngineParts } from "./compose-engine.js";

const nowMs = 1_800_000_000_000;
const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const wallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const cliToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const cliSecret = `bnt_${"1".repeat(43)}`;
const mcpToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const mcpSecret = `bnt_${"2".repeat(43)}`;
const account: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
// $600 a coin: 600 dollars in micro-dollars for 10^18 base units.
const coinPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const wallets = new Map([[wallet, account]]);
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

const limits: LimitsValues = {
  perTradeUsdMicros: 1_000_000_000n,
  rollingDayUsdMicros: 5_000_000_000n,
  slippageRegistryBps: bpsSchema.parse(50),
  slippageOtherBps: bpsSchema.parse(300),
  priceImpactBps: bpsSchema.parse(500),
  taxBps: bpsSchema.parse(1_000),
  liquidityFloorUsdMicros: 0n,
  minHealthFactorBp: 15_000,
  gasReserve: [{ chain: chainRefSchema.parse("fake:1"), reserveBase: 10n ** 15n }],
  venues: ["fake-swap"],
  allowTokens: [],
  denyTokens: [],
  modelBudgetUsdMicros: 5_000_000n,
  cardTradeExpiryS: 60,
  cardOtherExpiryS: 600,
  requoteAfterS: 10,
  requoteToleranceBps: bpsSchema.parse(50),
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: 20_000_000n,
  copyPerLeaderDayUsdMicros: 100_000_000n,
};

/** The two compositions: the self-hosted one and the Cloud-shaped test root. */
const compositions: readonly { readonly name: string; readonly parts: () => EngineParts }[] = [
  {
    // The self-hosted root's custody and Chainlink price adapters stand in as fakes here.
    name: "self-hosted",
    parts: () => ({
      custody: createFakeSigner(wallets),
      stores: createMemoryEngineStores(),
      prices: createFakePriceSource(new Map([[coin, coinPrice]])),
    }),
  },
  {
    name: "Cloud-shaped",
    parts: () => {
      const root = composeCloudTestRoot({ wallets });
      root.prices.publishPrice({ asset: coin, price: coinPrice, atMs: nowMs });
      return root;
    },
  },
];

async function seed(parts: EngineParts): Promise<void> {
  const created = await parts.stores.agents.create(
    {
      id: agent,
      name: "main",
      mode: "paper",
      locale: "en",
      models: {},
      notifications: {},
      atMs: nowMs - 1_000,
      limits,
      approvalMode: "manual",
      bySurface: "cli",
    },
    live(),
  );
  expect(created.ok).toBe(true);
  const cli = {
    id: cliToken,
    label: "cli",
    kind: "cli",
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
    secretHash: sha256Hex(cliSecret),
    createdAtMs: 0,
  } as const;
  await parts.stores.access.addToken(cli, live());
  const mcp = {
    id: mcpToken,
    label: "mcp",
    kind: "mcp",
    scopes: ["read", "propose"],
    secretHash: sha256Hex(mcpSecret),
    createdAtMs: 0,
  } as const;
  await parts.stores.access.addToken(mcp, live());
}

/** The engine, its server, an IPC stand-in and a CLI client, in one process. */
interface Skeleton {
  readonly client: ProtocolClient;
  readonly parts: EngineParts;
  readonly positions: PositionStore;
  /** Stands in for the wallet queue: what reached it. */
  readonly executor: FakeExecutor;
  /** Opens another client over the IPC stand-in, signed in with a token's secret. */
  connect(secret: string): Promise<ProtocolClient>;
  close(): Promise<void>;
}

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

async function startSkeleton(parts: EngineParts): Promise<Skeleton> {
  await seed(parts);
  const clock = createManualClock(nowMs);
  const chains = createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  const facts = {
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    feePerGasNativeBase: 1_000_000_000n,
    networkFeeCapNativeBase: 1_000_000_000n,
    recentOutflows: [],
  };
  const positions = createMemoryPositionStore();
  const executor = createFakeExecutor();
  const { server } = composeEngine(parts, {
    chains,
    venues: [createFakeVenue()],
    simulator: createQuoteSimulator(() => undefined),
    wallets: createFakeWalletFacts(new Map([[agent, [wallet]]]), facts),
    executor,
    positions,
    paperBalances: [{ asset: coin, base: 10n ** 18n }],
    version: "2026.10.0",
    owner: { locale: "en", timezone: "UTC" },
    clock,
    random: createSeededRandom(7),
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
  // The platform's IPC endpoint hands its sockets to the server the same way.
  const ipc = createNetServer((socket) => server.acceptIpc(socket));
  const port = await listen(ipc);
  const clients: ProtocolClient[] = [];
  const connect = async (secret: string): Promise<ProtocolClient> => {
    const opened = createProtocolClient({
      operations,
      openSocket: () => new WebSocket(`ws://127.0.0.1:${String(port)}/ws`),
      client: { kind: "cli", version: "test" },
      credential: { token: secret },
      clock,
      random: createSeededRandom(11 + clients.length),
      logger: createMemoryLogger({ subsystem: "client" }),
    });
    clients.push(opened);
    await opened.connect(AbortSignal.timeout(10_000));
    return opened;
  };
  const client = await connect(cliSecret);
  return {
    client,
    parts,
    positions,
    executor,
    connect,
    async close() {
      clients.forEach((opened) => opened.close());
      ipc.close();
      await server.close();
    },
  };
}

const swapRequest = {
  kind: "swap" as const,
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 1_000_000n },
};

const unsettled = (): void => undefined;

/** A promise and the call that resolves it. */
function deferred<T>() {
  let settle: (value: T) => void = unsettled;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value: T) => settle(value) };
}

/** Collects a topic's pushes and resolves once `count` arrived. */
function collect(client: ProtocolClient, topic: "intent" | "ledger", count: number) {
  const pushes: PushFrame[] = [];
  const all = deferred<readonly PushFrame[]>();
  const ready = deferred<undefined>();
  client.subscribe(topic, {
    onPush: (push) => {
      pushes.push(push);
      if (pushes.length === count) {
        all.resolve([...pushes]);
      }
    },
    refetch: async () => ready.resolve(undefined),
  });
  return { all: all.promise, ready: ready.promise };
}

describe.each(compositions)(
  "a paper swap through every layer on the $name composition",
  ({ parts }) => {
    let skeleton: Skeleton | undefined;

    afterEach(async () => {
      await skeleton?.close();
      skeleton = undefined;
    });

    it(
      "proposes, opens a card, confirms, fills at the quote and appends the ledger",
      {
        timeout: 60_000,
      },
      async () => {
        skeleton = await startSkeleton(parts());
        const { client } = skeleton;
        const intents = collect(client, "intent", 10);
        const ledger = collect(client, "ledger", 4);
        await Promise.all([intents.ready, ledger.ready]);
        const opened = await client.call("portfolio/resetPaper", { agent }, live());
        expect(opened.balances).toStrictEqual([
          {
            wallet,
            amount: { asset: coin, base: 10n ** 18n },
            usdMicros: 600_000_000n,
            paper: true,
          },
        ]);

        const proposed = await client.call("intent/propose", swapRequest, live());
        expect(proposed).toMatchObject({
          state: "awaiting_confirmation",
          paper: true,
          quote: {
            amountIn: { asset: coin, base: 1_000_000n },
            expectedOut: { asset: token, base: 2_000_000n },
            minOut: { asset: token, base: 1_990_000n },
            quotedAt: nowMs,
          },
          card: { version: 1, opensAt: nowMs, expiresAt: nowMs + 60_000, paper: true },
          assets: { [coin]: { symbol: "FAKE" }, [token]: { symbol: "TKN" } },
        });
        const card = proposed.card?.card as Id<"crd">;

        const confirmed = await client.call(
          "intent/confirm",
          { intent: proposed.intent, card, cardVersion: 1 },
          live(),
        );
        expect(confirmed.state).toBe("paper_filled");
        expect(confirmed.outcome?.executions).toStrictEqual([
          {
            amountIn: { asset: coin, base: 1_000_000n },
            amountOut: { asset: token, base: 2_000_000n },
            at: nowMs,
          },
        ]);

        const intentPushes = await intents.all;
        expect(intentPushes.map((push) => [push.seq, push.kind])).toStrictEqual([
          [1, "intent/created"],
          [2, "intent/changed"],
          [3, "intent/changed"],
          [4, "intent/changed"],
          [5, "intent/changed"],
          [6, "intent/changed"],
          [7, "card/opened"],
          [8, "intent/changed"],
          [9, "card/closed"],
          [10, "intent/changed"],
        ]);
        expect(intentPushes[6]?.data).toMatchObject({ intent: proposed.intent, card, version: 1 });
        expect(intentPushes[8]?.data).toMatchObject({ card, reason: "confirmed" });

        const ledgerPushes = await ledger.all;
        expect(ledgerPushes.map((push) => [push.seq, push.kind])).toStrictEqual([
          [1, "ledger/appended"],
          [2, "ledger/appended"],
          [3, "ledger/appended"],
          [4, "ledger/appended"],
        ]);
        const listed = await client.call("ledger/list", {}, live());
        expect(listed.items.map((entry) => [entry.kind, entry.subject])).toStrictEqual([
          ["proposed", proposed.intent],
          ["awaiting_confirmation", proposed.intent],
          ["confirmed", proposed.intent],
          ["paper_filled", proposed.intent],
        ]);
        expect(ledgerPushes.map((push) => push.data)).toStrictEqual(
          listed.items.map((item) => ({
            ...item,
          })),
        );
        expect(listed.items[3]?.data).toMatchObject({
          fill: {
            amountIn: { asset: coin, base: "1000000" },
            amountOut: { asset: token, base: "2000000" },
            atMs: nowMs,
          },
        });
        await expect(
          walkLedgerChain(skeleton.parts.stores.ledger, {}, live()),
        ).resolves.toMatchObject({ ok: true, value: { seq: 4 } });
        const held = await skeleton.positions.positions(
          { walletId: wallet, isPaper: true },
          live(),
        );
        expect(held.map((row) => [row.asset, row.quantityBase])).toStrictEqual([
          [coin, 10n ** 18n - 1_000_000n],
          [token, 2_000_000n],
        ]);
        expect(skeleton.executor.taken()).toStrictEqual([]);
      },
    );

    it(
      "goes live only on the owner's call, then hands a confirmed trade to the wallet queue",
      { timeout: 60_000 },
      async () => {
        skeleton = await startSkeleton(parts());
        const { client } = skeleton;
        const mcp = await skeleton.connect(mcpSecret);
        await expect(mcp.call("agent/goLive", { agent }, live())).rejects.toMatchObject({
          code: "auth.scope",
        });
        const stored = await skeleton.parts.stores.agents.get(agent, live());
        expect(stored?.agent.mode).toBe("paper");
        expect((await client.call("agent/goLive", { agent }, live())).mode).toBe("live");

        const proposed = await client.call("intent/propose", swapRequest, live());
        expect([proposed.paper, proposed.card?.paper]).toStrictEqual([false, false]);
        const card = proposed.card?.card as Id<"crd">;
        const confirmed = await client.call(
          "intent/confirm",
          { intent: proposed.intent, card, cardVersion: 1 },
          live(),
        );
        expect(confirmed.state).toBe("confirmed");
        expect(skeleton.executor.taken()).toStrictEqual([proposed.intent]);
      },
    );
  },
);
