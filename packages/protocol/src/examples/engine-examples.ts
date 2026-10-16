import type { AgentOperationShapes } from "../operations/agent-operations.schema.js";
import type { EngineOperationShapes } from "../operations/engine-operations.schema.js";
import type { WalletOperationShapes } from "../operations/wallet-operations.schema.js";
import {
  agentView,
  at,
  ids,
  intentView,
  nativeAmount,
  pageOf,
  refs,
  walletView,
  type WireExample,
} from "./wire-values.js";

const ownerKey = "bnok1abcde fghij klmno pqrst uvwxy z2345 67abc";
const empty = {};
const addressEntry = {
  entry: ids.entry,
  agent: ids.agent,
  address: refs.account,
  label: "Cold wallet",
  usableAt: at + 86_400_000,
  inCeilingAt: at,
  createdAt: at,
};

/** An example call of every engine and safety operation. */
export const engineExamples: { readonly [N in keyof EngineOperationShapes]: WireExample } = {
  "engine/status": {
    args: empty,
    result: {
      state: "ready",
      version: "2026.12.0",
      protocol: 1,
      frozen: false,
      agents: [{ id: ids.agent, mode: "live", frozen: true }],
      health: [
        { signal: "eventLoopLag", state: "ok" },
        { signal: "rpc", state: "warn" },
        { signal: "runtime", state: "fail", since: at },
        { signal: "watcher", state: "warn", since: at, lagBlocks: 4 },
      ],
    },
  },
  "engine/describe": {
    args: empty,
    result: {
      operations: [
        {
          name: "limit/set",
          scope: "confirm",
          scopeCase: { scope: "loosen", when: "looser" },
          kind: "write",
          idempotency: "key",
          transport: "any",
          answeredBy: "engine",
          since: "2026.10.0",
          args: { type: "object" },
          result: { type: "object" },
        },
      ],
    },
  },
  "engine/stop": { args: empty, result: empty },
  "engine/unlock": { args: { passphrase: "correct horse battery staple" }, result: empty },
  "safety/status": {
    args: empty,
    result: {
      frozen: true,
      frozenAt: at,
      agents: [{ agent: ids.agent, frozenAt: at }],
      rescue: { intent: ids.intent, state: "executing" },
      rescueAddress: refs.account,
      pendingRescueAddress: "fake:1:0x0000000d",
      pendingRescueAt: at + 86_400_000,
    },
  },
  "safety/freeze": { args: { agent: ids.agent }, result: { frozenAt: at } },
  "safety/unfreeze": { args: empty, result: { intent: ids.intent } },
  "safety/rescue": { args: empty, result: { intent: ids.intent } },
  "safety/setRescueAddress": {
    args: { address: refs.account },
    result: { effectiveAt: at + 86_400_000 },
  },
  "safety/cancelRescueChange": { args: empty, result: empty },
  "notice/list": {
    args: { cursor: ids.notice, limit: 20 },
    result: pageOf({
      id: ids.notice,
      at,
      key: "notice.lowGas",
      agent: ids.agent,
      values: { wallet: "Main" },
      amounts: { balance: nativeAmount },
      delivered: { telegram: "unknown_after_send" },
    }),
  },
  "notice/getSettings": {
    args: { agent: ids.agent },
    result: { muted: ["lowGas"], mutable: ["fill", "lowGas", "daily"], dailySummaryTime: "09:00" },
  },
  "notice/setSettings": {
    args: { agent: ids.agent, muted: ["lowGas"], dailySummaryTime: "08:30" },
    result: { muted: ["lowGas"], mutable: ["fill", "lowGas", "daily"], dailySummaryTime: "08:30" },
  },
  "telegram/pair": {
    args: empty,
    result: {
      link: "https://t.me/binference_test_bot?start=q3Zr_x9-AbCdEfGhIjKlMn",
      expiresAt: at,
    },
  },
};

/** An example call of every agent and identity operation. */
export const agentExamples: { readonly [N in keyof AgentOperationShapes]: WireExample } = {
  "agent/list": { args: { limit: 20 }, result: pageOf(agentView) },
  "agent/get": { args: { agent: ids.agent }, result: agentView },
  "agent/create": { args: { name: "Scout", locale: "zh" }, result: agentView },
  "agent/rename": { args: { agent: ids.agent, name: "Scout" }, result: agentView },
  "agent/archive": { args: { agent: ids.agent }, result: empty },
  "agent/goLive": {
    args: { agent: ids.agent, disclaimer: 2 },
    result: { ...agentView, mode: "live" },
  },
  "agent/goPaper": { args: { agent: ids.agent }, result: agentView },
  "agent/readFile": {
    args: { agent: ids.agent, file: "STRATEGY.md" },
    result: { text: "# Strategy\n", updatedAt: at },
  },
  "agent/writeFile": {
    args: { agent: ids.agent, file: "RULES.md", text: "Never trade memes.\n" },
    result: { updatedAt: at },
  },
  "facts/get": {
    args: { agent: ids.agent },
    result: {
      agent: ids.agent,
      at,
      timeZone: "Asia/Shanghai",
      mode: "paper",
      frozen: false,
      approvalMode: "manual",
      sendLevel: 0,
      balances: [{ wallet: ids.wallet, amount: nativeAmount, usdMicros: "900000000", paper: true }],
      totalUsdMicros: "900000000",
      orders: [],
      spentTodayUsdMicros: "25000000",
      perTradeUsdMicros: "50000000",
      rollingDayUsdMicros: "500000000",
      assets: {},
    },
  },
  "identity/get": {
    args: { agent: ids.agent },
    result: {
      registration: {
        registry: "fake:1:0x0000000e",
        onchainId: "42",
        txHash: "0xabc124",
        registeredAt: at,
      },
    },
  },
  "identity/register": { args: { agent: ids.agent }, result: intentView },
};

/** An example call of every wallet, ceiling, signer and address book operation. */
export const walletExamples: { readonly [N in keyof WalletOperationShapes]: WireExample } = {
  "wallet/list": { args: { agent: ids.agent }, result: pageOf(walletView) },
  "wallet/create": {
    args: { agent: ids.agent, label: "Main", ownerKey },
    result: walletView,
  },
  "wallet/rename": { args: { wallet: ids.wallet, label: "Main" }, result: walletView },
  "wallet/exportKey": {
    args: { wallet: ids.wallet, ownerKey },
    result: { privateKey: "encrypted-export" },
  },
  "wallet/exportSealed": {
    args: { wallet: ids.wallet, recipientPublicKey: "c2VhbGVkLXRv", ownerKey },
    result: { ciphertext: "Y2lwaGVydGV4dA==", encapsulatedKey: "ZW5jYXBzdWxhdGVk" },
  },
  "ceiling/get": {
    args: { wallet: ids.wallet },
    result: {
      wallet: ids.wallet,
      chains: [refs.chain],
      venues: ["fake-swap"],
      perTxNative: "1000000000000000000",
      recipients: [refs.account],
      dayCaps: [
        {
          asset: refs.native,
          limit: "10000000000000000000",
          windowSeconds: 86_400,
          floorUsdMicros: "1000000000",
        },
        {
          asset: refs.token,
          limit: "1000000000000000000000",
          windowSeconds: 86_400,
          floorUsdMicros: "1000000000",
        },
      ],
      readAt: at,
    },
  },
  "ceiling/set": {
    args: {
      wallet: ids.wallet,
      changes: { venues: ["fake-swap", "fake-lend"], perTxNative: "2000000000000000000" },
      ownerKey,
    },
    result: {
      wallet: ids.wallet,
      chains: [refs.chain],
      venues: ["fake-swap", "fake-lend"],
      perTxNative: "2000000000000000000",
      recipients: [],
      readAt: at,
    },
  },
  "signer/revoke": { args: { signer: "signer-7", ownerKey }, result: empty },
  "address/list": { args: { agent: ids.agent }, result: pageOf(addressEntry) },
  "address/add": {
    args: {
      agent: ids.agent,
      chain: refs.chain,
      address: "0x0000000c",
      label: "Cold wallet",
      ownerKey,
    },
    result: addressEntry,
  },
  "address/remove": { args: { entry: ids.entry }, result: empty },
};
