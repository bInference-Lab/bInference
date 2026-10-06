import type { ChatOperationShapes } from "../operations/chat-operations.schema.js";
import type { LimitOperationShapes } from "../operations/limit-operations.schema.js";
import type { NoteOperationShapes } from "../operations/note-operations.schema.js";
import { at, ids, pageOf, refs, type WireExample } from "./wire-values.js";

const empty = {};

const limits = {
  agent: ids.agent,
  perTradeUsdMicros: "100000000",
  rollingDayUsdMicros: "500000000",
  slippageRegistryBps: 100,
  slippageOtherBps: 500,
  priceImpactBps: 300,
  taxBps: 1_000,
  liquidityFloorUsdMicros: "10000000000",
  minHealthFactorBps: 15_000,
  gasReserve: { [refs.chain]: "2000000000000000" },
  venues: ["fake-swap"],
  allowTokens: [],
  denyTokens: [refs.token],
  modelBudgetUsdMicros: "3000000",
  cardTradeExpirySeconds: 60,
  cardOtherExpirySeconds: 600,
  requoteAfterSeconds: 10,
  requoteToleranceBps: 50,
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: "20000000",
  copyPerLeaderDayUsdMicros: "200000000",
  changedAt: at,
} as const;

const note = {
  note: "note-17",
  agent: ids.agent,
  text: "The owner sells half at 2x.",
  origin: "owner",
  createdAt: at,
  changedAt: at,
} as const;

/** An example call of every limit, send level and approval mode operation. */
export const limitExamples: { readonly [N in keyof LimitOperationShapes]: WireExample } = {
  "limit/get": { args: { agent: ids.agent }, result: limits },
  "limit/set": {
    args: { agent: ids.agent, changes: { perTradeUsdMicros: "50000000", denyTokens: [] } },
    result: limits,
  },
  "sendLevel/get": {
    args: { agent: ids.agent },
    result: { level: 2, pending: { level: 1, effectiveAt: at + 86_400_000 } },
  },
  "sendLevel/set": { args: { agent: ids.agent, level: 3 }, result: { level: 3 } },
  "sendLevel/cancelPending": { args: { agent: ids.agent }, result: { level: 2 } },
  "approval/get": { args: { agent: ids.agent }, result: { mode: "manual", changedAt: at } },
  "approval/set": {
    args: { agent: ids.agent, mode: "auto" },
    result: { mode: "auto", changedAt: at },
  },
};

/** An example call of every chat, turn and usage operation. */
export const chatExamples: { readonly [N in keyof ChatOperationShapes]: WireExample } = {
  "chat/post": {
    args: { agent: ids.agent, text: "What moved today?", images: ["upload-1"] },
    result: { session: ids.session, turn: ids.turn },
  },
  "chat/messages": {
    args: { agent: ids.agent, session: ids.session, limit: 50 },
    result: pageOf(
      { session: ids.session, turn: ids.turn, seq: 1, role: "owner", kind: "text", text: "Hi", at },
      { session: ids.session, seq: 2, role: "system", kind: "summary", at },
    ),
  },
  "chat/stop": { args: { agent: ids.agent }, result: empty },
  "chat/clear": { args: { agent: ids.agent }, result: { session: ids.session } },
  "turn/say": {
    args: { agent: ids.agent, session: ids.session, turn: ids.turn, text: "Done.", final: true },
    result: empty,
  },
  "turn/status": {
    args: {
      agent: ids.agent,
      turn: ids.turn,
      statusKey: "chat.status.reading",
      values: { source: "page", count: 2 },
    },
    result: empty,
  },
  "turn/end": { args: { agent: ids.agent, turn: ids.turn, outcome: "budget" }, result: empty },
  "usage/record": {
    args: {
      agent: ids.agent,
      turn: ids.turn,
      model: "binference/large",
      inputTokens: 1_200,
      outputTokens: 300,
      cachedTokens: 800,
      usdMicros: "4100",
    },
    result: { budgetLeftMicros: "2995900" },
  },
  "usage/get": {
    args: { from: at, to: at + 86_400_000 },
    result: {
      rows: [
        {
          agent: ids.agent,
          dayAt: at,
          model: "binference/large",
          inputTokens: 1_200,
          outputTokens: 300,
          cachedTokens: 800,
          usdMicros: "4100",
        },
      ],
      budgets: [{ agent: ids.agent, dailyUsdMicros: "3000000", leftUsdMicros: "2995900" }],
    },
  },
};

/** An example call of every notes operation. */
export const noteExamples: { readonly [N in keyof NoteOperationShapes]: WireExample } = {
  "notes/search": { args: { agent: ids.agent, query: "2x", limit: 5 }, result: pageOf(note) },
  "notes/list": { args: { agent: ids.agent, cursor: "cursor-1" }, result: pageOf(note) },
  "notes/write": { args: { agent: ids.agent, text: note.text }, result: note },
  "notes/delete": { args: { note: "note-17" }, result: empty },
};
