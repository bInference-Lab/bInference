import type { AccountRef, Amount, Signer } from "@binference/chain";
import { err, type Id, type JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  driveUntil,
  type ExecutorBench,
  startExecutorBench,
  tapped,
} from "../executor/test-executor.js";
import { createMemoryBreaker, type MemoryBreaker } from "../fakes/memory-breaker.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import { testAccount, testCall, testCallers, testChains } from "../operations/test-engine.js";
import { wholeToken } from "../orders/test-fills.js";
import { activeOrderOf, fillOnce, liveFillsOf, startLiveFills } from "../orders/test-live-fills.js";
import { testStopLoss } from "../orders/test-orders.js";
import type { IntentStore } from "../ports.js";
import { breakerApprovalNotices } from "./breaker-approvals.js";

const live = { signal: new AbortController().signal };

type Answer = "locked" | "refused";

interface Sale {
  readonly bench: ExecutorBench;
  readonly sale: Id<"int">;
}

const pulledNotice = { key: "notice.breakerPulled", values: {} };
const liftedNotice = {
  key: "notice.breakerLifted",
  values: { frozen: "none" },
  lists: { agents: [] },
};

function heldTokens(): ReadonlyMap<AccountRef, readonly Amount[]> {
  return new Map([[testAccount, [{ asset: testToken, base: wholeToken }]]]);
}

// Custody that signs the first step and answers every later one as `answer` says: a signer
// service that took the breaker's hold, or a plain refusal.
function signsFirstOnly(answer: Answer): (custody: Signer) => Signer {
  const later =
    answer === "locked"
      ? ({ ok: false, error: "locked", lock: "breaker" } as const)
      : err("refused");
  return (custody) => ({
    account: async (wallet, chain, call) => custody.account(wallet, chain, call),
    signTransaction: async (request, call) =>
      request.step.index === 0 ? custody.signTransaction(request, call) : later,
  });
}

// The breaker's notices the engine published, oldest first, each as its key, values and amounts.
function breakerNotices(bench: ExecutorBench): readonly unknown[] {
  return bench.test.pushes
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => data as Readonly<Record<string, unknown>>)
    .filter(({ key }) => String(key).startsWith("notice.breaker"))
    .map(({ key, values, amounts, lists }) =>
      Object.fromEntries(
        Object.entries({ key, values, amounts, lists }).filter(
          ([, field]: readonly [string, unknown]) => field !== undefined,
        ),
      ),
    );
}

// A stop-loss order's live sale of the held token.
function liveSale(answer: Answer): (breaker: MemoryBreaker) => Promise<Sale> {
  return async (breaker) => {
    const custody = signsFirstOnly(answer);
    const bench = await startLiveFills({ held: heldTokens(), custody, engineStores: { breaker } });
    const order = await activeOrderOf(bench, testStopLoss());
    await fillOnce(bench, order.id);
    const [sale] = await liveFillsOf(bench, "sell");
    return { bench, sale: sale?.id as Id<"int"> };
  };
}

// The owner's own tapped sale of the token.
async function tappedSale(breaker: MemoryBreaker): Promise<Sale> {
  const custody = signsFirstOnly("locked");
  const bench = await startExecutorBench({ custody, engine: { breaker } });
  const request = testSwap({ from: testToken, to: testCoin, amount: { base: wholeToken } });
  return { bench, sale: await tapped(bench, request) };
}

// The agent's own sale of the token in auto mode, which carries its auto grant.
async function autoSale(breaker: MemoryBreaker): Promise<Sale> {
  const custody = signsFirstOnly("locked");
  const agent = { approvalMode: "auto" } as const;
  const bench = await startExecutorBench({ custody, engine: { breaker }, agent });
  const request = testSwap({ from: testToken, to: testCoin, amount: { base: wholeToken } });
  const handlers = bench.test.engine.handlers;
  const view = expectOk(await handlers["intent/propose"](testCall(request, testCallers.runtime)));
  return { bench, sale: view.intent };
}

// A sale whose approval landed and whose swap custody would not sign, then a pull the engine
// applied `pullAfterMs` after the sale ended, its row changed `rowAfterMs` after it (the same when
// absent), and a lift; what the sale stored and what custody was asked.
async function soldUnder(
  after: number | { readonly pullAfterMs: number; readonly rowAfterMs: number },
  start: (breaker: MemoryBreaker) => Promise<Sale>,
) {
  const { pullAfterMs, rowAfterMs } =
    typeof after === "number" ? { pullAfterMs: after, rowAfterMs: after } : after;
  const breaker = createMemoryBreaker();
  const { bench, sale } = await start(breaker);
  await driveUntil(bench, sale, { states: ["failed_onchain"] });
  const endedAtMs = bench.test.clock.now();
  await bench.test.clock.advance(pullAfterMs);
  breaker.pull(endedAtMs + rowAfterMs);
  await bench.test.engine.followBreaker(live);
  breaker.lift(bench.test.clock.now() + 1);
  await bench.test.engine.followBreaker(live);
  const stored = await bench.test.stores.intents.get(sale, live);
  const signed = bench.signed.map(({ step }) => step.action.kind);
  return { bench, stored, ended: [stored?.state, stored?.reason], signed };
}

// The sale as it ended, which the bench always stores.
function endedOf(stored: IntentRecord | undefined): IntentRecord {
  if (stored === undefined) {
    throw new Error("Expected the sale to be stored.");
  }
  return stored;
}

// The asset infos a notice push carries.
function assetsOf(data: JsonValue): unknown {
  return typeof data === "object" && data !== null && "assets" in data ? data["assets"] : undefined;
}

// The key of a notice the helper above drew.
function keyOf(notice: unknown): unknown {
  return typeof notice === "object" && notice !== null && "key" in notice ? notice.key : undefined;
}

// The approvals told of what an intent store lists, which answers `pages` in turn.
async function toldOfPages(bench: ExecutorBench, pages: readonly (readonly IntentRecord[])[]) {
  const next = { at: 0 };
  const list = async () => {
    const page = pages[next.at] ?? [];
    next.at += 1;
    return Promise.resolve(page);
  };
  const intents: IntentStore = { ...bench.test.stores.intents, list };
  const parts = { intents, transactions: bench.test.stores.transactions, chains: testChains() };
  return breakerApprovalNotices(parts, { breakerAtMs: 0, signal: live.signal });
}

// The approvals told of `record` as an intent store that lists only it holds it, its plan's
// second step an approval like its first.
async function toldOfTwoApprovals(bench: ExecutorBench, record: IntentRecord | undefined) {
  const [first] = record?.plan === undefined ? [] : planDocument.decode(record.plan);
  const twice: readonly IntentRecord[] =
    record === undefined || first === undefined
      ? []
      : [{ ...record, plan: planDocument.encode([first, first]) }];
  const intents: IntentStore = { ...bench.test.stores.intents, list: async () => twice };
  const parts = { intents, transactions: bench.test.stores.transactions, chains: testChains() };
  return breakerApprovalNotices(parts, { breakerAtMs: 0, signal: live.signal });
}

describe("the lift and the approvals fills left while the breaker held", () => {
  it("names the wallet, the spender and the allowance of a fill's approval that landed", async () => {
    const { bench, ended, signed } = await soldUnder(30_000, liveSale("locked"));
    expect([ended, signed]).toStrictEqual([
      ["failed_onchain", "signer_locked"],
      ["approve", "call"],
    ]);
    expect(breakerNotices(bench)).toStrictEqual([
      pulledNotice,
      liftedNotice,
      {
        key: "notice.breakerApprovalLeft",
        values: { wallet: "0x0000000c", spender: "0x0000000b" },
        amounts: { approved: { asset: testToken, base: wholeToken.toString() } },
      },
    ]);
  });

  it("tells no approval of a step the service refused, only those signed before it", async () => {
    const { bench, stored } = await soldUnder(30_000, liveSale("locked"));
    const told = await toldOfTwoApprovals(bench, stored);
    expect(told).toHaveLength(1);
  });

  it("looks back from when the breaker's row turned, not from when the engine applied it", async () => {
    const { bench } = await soldUnder(
      { pullAfterMs: 90_000, rowAfterMs: 30_000 },
      liveSale("locked"),
    );
    expect(breakerNotices(bench).map((notice) => keyOf(notice))).toStrictEqual([
      "notice.breakerPulled",
      "notice.breakerLifted",
      "notice.breakerApprovalLeft",
    ]);
  });

  it("reads every page of the intents that ended, and names the token by what it answered", async () => {
    const { bench, stored } = await soldUnder(30_000, liveSale("locked"));
    const sale = endedOf(stored);
    const others = Array.from({ length: 500 }, () => ({ ...sale, reason: "reverted" as const }));
    const told = await toldOfPages(bench, [others, [sale]]);
    expect(told.map(({ data }) => assetsOf(data))).toStrictEqual([
      intentAssetInfos(testChains(), sale, [testToken]),
    ]);
  });

  it("tells no approval of a fill that ended over a minute before the hold", async () => {
    const { bench } = await soldUnder(61_000, liveSale("locked"));
    expect(breakerNotices(bench)).toStrictEqual([pulledNotice, liftedNotice]);
  });

  it("tells no approval of a fill custody refused for its own rules", async () => {
    const { bench, ended } = await soldUnder(30_000, liveSale("refused"));
    expect(ended[0]).toBe("failed_onchain");
    expect(breakerNotices(bench)).toStrictEqual([pulledNotice, liftedNotice]);
  });

  it("tells no approval of an auto mode trade, whose grant is not a fill's", async () => {
    const { bench, stored } = await soldUnder(30_000, autoSale);
    expect([stored?.state, stored?.reason, stored?.authorizedBy]).toMatchObject([
      "failed_onchain",
      "signer_locked",
      { approvalMode: "auto" },
    ]);
    expect(breakerNotices(bench)).toStrictEqual([pulledNotice, liftedNotice]);
  });

  it("tells no approval of the owner's own trade, which its notice already told", async () => {
    const { bench, ended } = await soldUnder(30_000, tappedSale);
    expect(ended).toStrictEqual(["failed_onchain", "signer_locked"]);
    expect(breakerNotices(bench)).toStrictEqual([pulledNotice, liftedNotice]);
  });
});
