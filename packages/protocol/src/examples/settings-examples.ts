import type { AccessOperationShapes } from "../operations/access-operations.schema.js";
import type { BinanceAgentOperationShapes } from "../operations/binance-agent-operations.schema.js";
import type { PluginOperationShapes } from "../operations/plugin-operations.schema.js";
import type { SettingsOperationShapes } from "../operations/settings-operations.schema.js";
import type { StreamOperationShapes } from "../operations/stream-operations.schema.js";
import { at, ids, pageOf, refs, type WireExample } from "./wire-values.js";

const empty = {};
const job = { job: ids.job };
const file = { url: "http://127.0.0.1:7456/file/ticket-1", expiresAt: at + 300_000 };
const hash = "a".repeat(64);
const install = { source: "npm:@binference/plugin-fake-swap", hash: `sha256:${hash}` };
const model = {
  role: "main",
  model: "binference/large",
  prices: {
    inputPerMTokUsdMicros: "3000000",
    outputPerMTokUsdMicros: "15000000",
    cachedPerMTokUsdMicros: "300000",
  },
} as const;
const plugin = {
  plugin: ids.plugin,
  name: "fake-swap",
  version: "2026.10.0",
  tier: "community",
  source: install.source,
  hash: install.hash,
  permissions: ["network:api.example.invalid"],
  state: "disabled",
  installedAt: at,
} as const;
const config = { locale: "zh", models: { apiKey: { fromKeychain: "secret" } } };
const binanceAgent = { agent: ids.agent, label: "Futures bot", state: "paused" } as const;
const trade = { at, what: "buy", orderId: "991", outcome: "filled" };

/** An example call of every model, plugin and skill operation. */
export const pluginExamples: { readonly [N in keyof PluginOperationShapes]: WireExample } = {
  "model/list": { args: empty, result: pageOf(model, { role: "vision", model: "fake/eyes" }) },
  "model/set": {
    args: { agent: ids.agent, role: "main", model: "binference/large" },
    result: pageOf(model),
  },
  "plugin/list": { args: empty, result: pageOf(plugin) },
  "plugin/add": { args: install, result: job },
  "plugin/enable": { args: { plugin: ids.plugin }, result: { ...plugin, state: "enabled" } },
  "plugin/disable": { args: { plugin: ids.plugin }, result: plugin },
  "plugin/remove": { args: { plugin: ids.plugin }, result: empty },
  "skill/list": {
    args: { agent: ids.agent },
    result: pageOf({ skill: "skill-1", name: "dip-buyer", ...install, installedAt: at }),
  },
  "skill/add": { args: install, result: job },
  "skill/remove": { args: { skill: "skill-1" }, result: empty },
};

/** An example call of every settings, ledger, backup, update and check operation. */
export const settingsExamples: { readonly [N in keyof SettingsOperationShapes]: WireExample } = {
  "config/read": { args: empty, result: { config } },
  "config/change": {
    args: { patch: { locale: "en" }, reason: "Switch to English." },
    result: { config, restartNeeded: false },
  },
  "config/history": {
    args: { limit: 1 },
    result: pageOf({
      at,
      by: ids.token,
      surface: "cli",
      path: "locale",
      before: "en",
      after: "zh",
      reason: "Owner asked.",
    }),
  },
  "ledger/list": {
    args: { agent: ids.agent, from: at, limit: 2 },
    result: pageOf({
      seq: 1,
      entry: ids.ledgerEntry,
      at,
      agent: ids.agent,
      kind: "intent.reconciled",
      subject: ids.intent,
      data: { state: "reconciled" },
      prevHash: "0".repeat(64),
      hash,
    }),
  },
  "ledger/export": { args: { from: at, to: at + 1 }, result: file },
  "backup/list": {
    args: empty,
    result: pageOf({ backup: ids.backup, kind: "daily", bytes: 4_096, createdAt: at }),
  },
  "backup/create": { args: { copyTo: "backups/extra" }, result: job },
  "backup/restore": { args: { backup: ids.backup }, result: job },
  "update/check": {
    args: empty,
    result: { current: "2026.10.0", latest: "2026.11.0", channel: "stable", notes: "Fixes." },
  },
  "update/apply": { args: { version: "2026.11.0" }, result: job },
  "check/run": { args: { fix: true, only: ["ledger.chain"] }, result: job },
  "report/create": { args: empty, result: job },
};

/** An example call of every device, token, remote access and exchange operation. */
export const accessExamples: { readonly [N in keyof AccessOperationShapes]: WireExample } = {
  "device/list": {
    args: empty,
    result: pageOf({ device: ids.device, label: "Laptop", alg: "ed25519", createdAt: at }),
  },
  "device/revoke": { args: { device: ids.device }, result: empty },
  "token/list": {
    args: empty,
    result: pageOf({
      token: ids.token,
      label: "mcp",
      kind: "mcp",
      scopes: ["read", "propose"],
      createdAt: at,
      lastUsedAt: at,
    }),
  },
  "token/create": {
    args: { label: "hooks", scopes: ["agent"] },
    result: { token: `bnt_${"Q9-_z".repeat(8)}abc` },
  },
  "token/revoke": { args: { token: ids.token }, result: empty },
  "remote/status": {
    args: empty,
    result: { tailscale: "running", miniUrl: "https://owner.example.invalid/mini" },
  },
  "remote/enable": { args: { mini: true }, result: job },
  "remote/disable": { args: empty, result: empty },
  "cex/status": {
    args: empty,
    result: { state: "connected", scopes: ["read", "trade"], connectedAt: at },
  },
  "cex/connect": {
    args: empty,
    result: { authorizeUrl: "https://accounts.example.invalid/oauth/authorize?client=1" },
  },
  "cex/disconnect": { args: empty, result: empty },
};

/** An example call of every upload, push and log stream operation. */
export const streamExamples: { readonly [N in keyof StreamOperationShapes]: WireExample } = {
  "upload/start": {
    args: { contentType: "image/png", bytes: 120_000 },
    result: { url: "http://127.0.0.1:7456/upload/ticket-2", expiresAt: at + 120_000 },
  },
  "push/subscribe": {
    args: { topics: { intent: { fromSeq: 41 }, [`chat:${ids.agent}`]: {} } },
    result: { seqs: { intent: 60, [`chat:${ids.agent}`]: 0 }, resync: ["intent"] },
  },
  "push/unsubscribe": { args: { topics: ["intent"] }, result: empty },
  "log/follow": { args: { level: "warn" }, result: empty },
  "log/unfollow": { args: empty, result: empty },
};

/** An example call of every Binance Agent operation. */
export const binanceAgentExamples: {
  readonly [N in keyof BinanceAgentOperationShapes]: WireExample;
} = {
  "binanceAgent/list": { args: empty, result: pageOf(binanceAgent) },
  "binanceAgent/connect": {
    args: { folder: "agents/futures", label: "Futures bot" },
    result: binanceAgent,
  },
  "binanceAgent/timeline": { args: { agent: ids.agent, limit: 10 }, result: pageOf(trade) },
  "binanceAgent/setLimits": {
    args: { agent: ids.agent, limits: { dailyUsdMicros: "100000000", denyTokens: [refs.token] } },
    result: { dailyUsdMicros: "100000000", denyTokens: [refs.token] },
  },
  "binanceAgent/pause": { args: { agent: ids.agent }, result: { state: "paused" } },
  "binanceAgent/resume": { args: { agent: ids.agent }, result: { state: "running" } },
  "binanceAgent/stop": { args: { agent: ids.agent }, result: { state: "stopped" } },
  "binanceAgent/record": {
    args: { agent: ids.agent, from: at, to: at + 1, format: "csv" },
    result: file,
  },
  "binanceAgent/report": { args: { agent: ids.agent, event: trade }, result: empty },
};
