import type { AgentOperationShapes } from "../operations/agent-operations.schema.js";
import type { EngineOperationShapes } from "../operations/engine-operations.schema.js";
import type { WalletOperationShapes } from "../operations/wallet-operations.schema.js";
import {
  agentView,
  at,
  ids,
  intentView,
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
  "safety/status": {
    args: empty,
    result: {
      frozen: true,
      frozenAt: at,
      rescueAddress: refs.account,
      pendingRescueAddress: "fake:1:0x0000000d",
    },
  },
  "safety/freeze": { args: { agent: ids.agent }, result: { frozenAt: at } },
  "safety/unfreeze": { args: empty, result: empty },
  "safety/rescue": { args: empty, result: { intent: ids.intent } },
  "safety/setRescueAddress": {
    args: { address: refs.account },
    result: { effectiveAt: at + 86_400_000 },
  },
  "safety/cancelRescueChange": { args: empty, result: empty },
};

/** An example call of every agent and identity operation. */
export const agentExamples: { readonly [N in keyof AgentOperationShapes]: WireExample } = {
  "agent/list": { args: { limit: 20 }, result: pageOf(agentView) },
  "agent/get": { args: { agent: ids.agent }, result: agentView },
  "agent/create": { args: { name: "Scout", locale: "zh" }, result: agentView },
  "agent/rename": { args: { agent: ids.agent, name: "Scout" }, result: agentView },
  "agent/archive": { args: { agent: ids.agent }, result: empty },
  "agent/goLive": { args: { agent: ids.agent }, result: { ...agentView, mode: "live" } },
  "agent/goPaper": { args: { agent: ids.agent }, result: agentView },
  "agent/readFile": {
    args: { agent: ids.agent, file: "STRATEGY.md" },
    result: { text: "# Strategy\n", updatedAt: at },
  },
  "agent/writeFile": {
    args: { agent: ids.agent, file: "RULES.md", text: "Never trade memes.\n" },
    result: { updatedAt: at },
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
  "ceiling/get": {
    args: { wallet: ids.wallet },
    result: {
      wallet: ids.wallet,
      chains: [refs.chain],
      venues: ["fake-swap"],
      perTxNative: "1000000000000000000",
      recipients: [refs.account],
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
