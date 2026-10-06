import { describe, expect, it } from "vitest";
import { deviceRecordSchema } from "../access/device-record.js";
import { pairCodeRecordSchema, pairCodeUseSchema } from "../access/pair-code-record.js";
import { tokenRecordSchema } from "../access/token-record.js";
import { agentDraftSchema, agentRecordSchema } from "../agents/agent-record.js";
import { approvalModeChangeSchema } from "../agents/approval-mode-record.js";
import { limitsValuesSchema } from "../agents/limits-record.js";
import { configChangeSchema } from "../audit/config-change.js";
import { idempotencyLookupSchema, idempotencyRecallSchema } from "../ingress/idempotency-entry.js";
import { inboxDraftSchema } from "../ingress/inbox-entry.js";
import { cardOpeningSchema } from "../intents/card-record.js";
import { intentChangeSchema, intentQuerySchema } from "../intents/intent-change.js";
import { intentDraftSchema, intentProposerRefSchema } from "../intents/intent-record.js";
import { ledgerDraftSchema } from "../ledger/ledger-entry.js";
import { rowPageSchema } from "./row-page.js";
import { isSha256Hex, sha256Hex } from "./sha256-hex.js";
import { stampedIdSchema } from "./stamped-id.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
const hash = "a".repeat(64);
const card = { id: `crd_${uuid}`, version: 1, termsHash: hash, openedAtMs: 2, expiresAtMs: 3 };

// One fixture of each store shape that crosses the worker boundary, as a caller writes it.
const intentDraft = {
  id: `int_${uuid}`,
  agentId: `agt_${uuid}`,
  walletId: `wal_${uuid}`,
  kind: "swap",
  state: "proposed",
  request: {},
  hasOutsideContent: false,
  isPaper: true,
  proposer: "telegram",
  atMs: 1,
  cause: {},
};
const intentChange = {
  id: `int_${uuid}`,
  expectedVersion: 0,
  state: "awaiting_confirmation",
  atMs: 2,
  cause: {},
  fields: { quote: { minOut: "1" } },
  openCard: card,
};
const token = {
  id: `tok_${uuid}`,
  label: "cli",
  kind: "cli",
  scopes: ["admin"],
  secretHash: hash,
  createdAtMs: 1,
};
const device = {
  id: `dev_${uuid}`,
  label: "phone",
  alg: "ed25519",
  publicKey: "k",
  createdAtMs: 1,
};
const agent = {
  id: `agt_${uuid}`,
  name: "main",
  mode: "live",
  locale: "en",
  models: {},
  notifications: {},
  frozenAtMs: 9,
  createdAtMs: 1,
  changedAtMs: 1,
  version: 3,
};
const limits = {
  perTradeUsdMicros: 1n,
  rollingDayUsdMicros: 2n ** 64n + 1n,
  slippageRegistryBps: 50,
  slippageOtherBps: 300,
  priceImpactBps: 500,
  taxBps: 1_000,
  liquidityFloorUsdMicros: 0n,
  minHealthFactorBp: 15_000,
  gasReserve: [{ chain: "fake:1", reserveBase: 5n }],
  venues: [],
  allowTokens: [],
  denyTokens: ["fake:1/token:a"],
  modelBudgetUsdMicros: 0n,
  cardTradeExpiryS: 60,
  cardOtherExpiryS: 600,
  requoteAfterS: 10,
  requoteToleranceBps: 50,
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: 0n,
  copyPerLeaderDayUsdMicros: 0n,
};
const agentDraft = {
  id: `agt_${uuid}`,
  name: "a",
  mode: "paper",
  locale: "zh",
  models: null,
  notifications: [],
  atMs: 1,
  limits,
  approvalMode: "manual",
  bySurface: "cli",
};
const lookup = { credential: "tok_1", op: "intent/propose", key: "k", argsHash: hash };

describe("store record schemas", () => {
  it("parses a fixture of every store shape as written", () => {
    expect(intentDraftSchema.parse(intentDraft)).toStrictEqual(intentDraft);
    expect(intentChangeSchema.parse(intentChange)).toStrictEqual(intentChange);
    expect(intentQuerySchema.parse({ states: ["proposed"], limit: 10 })).toBeDefined();
    const bare = { id: `led_${uuid}`, atMs: 1, kind: "freeze", data: null };
    expect(ledgerDraftSchema.parse(bare)).toStrictEqual(bare);
    expect(idempotencyLookupSchema.parse(lookup)).toStrictEqual(lookup);
    const repeat = { kind: "repeat", result: [1, "two"] };
    expect(idempotencyRecallSchema.parse(repeat)).toStrictEqual(repeat);
    const update = { source: "webhook", sourceKey: "wh:1", payload: {}, receivedAtMs: 1 };
    expect(inboxDraftSchema.parse(update)).toStrictEqual(update);
    expect(tokenRecordSchema.parse(token)).toStrictEqual(token);
    expect(deviceRecordSchema.parse(device)).toStrictEqual(device);
    expect(pairCodeRecordSchema.parse({ codeHash: hash, expiresAtMs: 5 })).toBeDefined();
    expect(pairCodeUseSchema.parse({ codeHash: hash, atMs: 4 })).toBeDefined();
    expect(stampedIdSchema("tok").parse({ id: `tok_${uuid}`, atMs: 4 })).toBeDefined();
    expect(rowPageSchema.parse({ after: 0, limit: 1_000 })).toBeDefined();
    const mode = { agentId: `agt_${uuid}`, mode: "auto", bySurface: "mini", atMs: 1 };
    expect(approvalModeChangeSchema.parse({ ...mode, expectedVersion: 0 })).toBeDefined();
    const change = { atMs: 1, by: "engine", surface: "cli", path: "a.b", before: null };
    expect(configChangeSchema.parse(change)).toStrictEqual(change);
    expect(agentRecordSchema.parse(agent)).toStrictEqual(agent);
    expect(agentDraftSchema.parse(agentDraft)).toStrictEqual(agentDraft);
    expect(limitsValuesSchema.parse(limits)).toStrictEqual(limits);
  });

  it("refuses malformed values", () => {
    expect(intentProposerRefSchema.safeParse("tok_1").success).toBe(false);
    expect(intentQuerySchema.safeParse({ states: [], limit: 1 }).success).toBe(false);
    expect(rowPageSchema.safeParse({ after: 0, limit: 1_001 }).success).toBe(false);
    expect(cardOpeningSchema.safeParse({ ...card, version: 0 }).success).toBe(false);
    expect(cardOpeningSchema.safeParse({ ...card, callbackRef: "short" }).success).toBe(false);
    const longKey = { ...lookup, key: "k".repeat(65) };
    expect(idempotencyLookupSchema.safeParse(longKey).success).toBe(false);
  });

  it("hashes text as 64 lowercase hex digits and knows one when it sees it", () => {
    const digest = sha256Hex("abc");
    expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const seen = [isSha256Hex(digest), isSha256Hex(digest.toUpperCase()), isSha256Hex("ab")];
    expect(seen).toStrictEqual([true, false, false]);
  });
});
