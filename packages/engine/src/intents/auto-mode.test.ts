import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ApprovalMode,
  type AutoModeFacts,
  type AutoModeSubject,
  checkAutoMode,
} from "./auto-mode.js";
import { type IntentKind, intentKinds } from "./intent-kind.js";
import type { IntentProposer } from "./intent-status.js";

const facts: AutoModeFacts = {
  approvalMode: "auto",
  modeVersion: 2,
  isInsideOwnPositions: true,
  valueUsdMicros: 100_000_000n,
  perTradeCapUsdMicros: 100_000_000n,
  rollingDayCapUsdMicros: 500_000_000n,
  rollingDaySpentUsdMicros: 400_000_000n,
  hasUnlistedSpender: false,
};

const swap: AutoModeSubject = { kind: "swap", proposer: "agent_runtime", hasOutsideContent: false };

function refusalOf(subject: AutoModeSubject, overrides: Partial<AutoModeFacts> = {}) {
  const result = checkAutoMode(subject, { ...facts, ...overrides });
  return result.ok ? "passes" : result.error;
}

describe("the auto test", () => {
  it("authorizes a swap at the caps under the mode's version", () => {
    expect(checkAutoMode(swap, facts)).toStrictEqual({
      ok: true,
      value: { approvalMode: "auto", modeVersion: 2 },
    });
  });

  it("names why each kind asks", () => {
    const outcomes = intentKinds.map((kind) => [kind, refusalOf({ ...swap, kind })]);
    expect(Object.fromEntries(outcomes)).toStrictEqual({
      swap: "passes",
      buy: "passes",
      sell: "passes",
      send: "send",
      revokeApproval: "kind",
      lend: "passes",
      stake: "passes",
      bridge: "send",
      cexOrder: "kind",
      registerIdentity: "kind",
      launchToken: "kind",
      rescue: "send",
    });
  });

  it("asks for a lend or stake move that leaves the agent's own positions", () => {
    expect(refusalOf({ ...swap, kind: "lend" }, { isInsideOwnPositions: false })).toBe("kind");
    expect(refusalOf({ ...swap, kind: "stake" }, { isInsideOwnPositions: false })).toBe("kind");
  });

  it("asks when the value passes the per-trade or rolling-day cap", () => {
    const fresh = { rollingDaySpentUsdMicros: 0n };
    expect(refusalOf(swap, { ...fresh, valueUsdMicros: 100_000_001n })).toBe("overCap");
    expect(refusalOf(swap, { rollingDaySpentUsdMicros: 400_000_001n })).toBe("overCap");
  });

  it("asks for an unlisted spender, outside content and every proposer but the runtime", () => {
    expect(refusalOf(swap, { hasUnlistedSpender: true })).toBe("spender");
    expect(refusalOf({ ...swap, hasOutsideContent: true })).toBe("outside");
    const proposers: readonly IntentProposer[] = ["mcp_client", "owner", "engine"];
    expect(proposers.map((proposer) => refusalOf({ ...swap, proposer }))).toStrictEqual([
      "mcp",
      "mcp",
      "mcp",
    ]);
  });

  it("asks in manual mode before anything else", () => {
    const everything = { ...swap, kind: "send", hasOutsideContent: true, proposer: "mcp_client" };
    expect(refusalOf(everything as AutoModeSubject, { approvalMode: "manual" })).toBe("manual");
  });

  it("checks in the order spec 6 lists the conditions", () => {
    const send = { ...swap, kind: "send", hasOutsideContent: true } as const;
    expect(refusalOf(send, { valueUsdMicros: 10n ** 12n })).toBe("send");
    expect(refusalOf(swap, { valueUsdMicros: 10n ** 12n, hasUnlistedSpender: true })).toBe(
      "overCap",
    );
    expect(refusalOf({ ...swap, hasOutsideContent: true }, { hasUnlistedSpender: true })).toBe(
      "spender",
    );
    expect(refusalOf({ ...swap, hasOutsideContent: true, proposer: "mcp_client" })).toBe("outside");
  });
});

// Each condition holds most of the time, so the cap cases meet an otherwise allowed intent.
function mostly<T>(usual: T, ...rare: readonly T[]): fc.Arbitrary<T> {
  return fc.oneof(
    { weight: 3, arbitrary: fc.constant(usual) },
    { weight: 1, arbitrary: fc.constantFrom(...rare) },
  );
}

const subjects = fc.record({
  kind: mostly<IntentKind>("swap", ...intentKinds),
  proposer: mostly<IntentProposer>("agent_runtime", "mcp_client", "owner", "engine"),
  hasOutsideContent: mostly(false, true),
});

const usd = fc.bigInt({ min: 0n, max: 10n ** 15n });
// Below, at or above a cap, in equal measure.
const headroom = fc.oneof(
  fc.bigInt({ min: -1_000n, max: -1n }),
  fc.constant(0n),
  fc.bigInt({ min: 1n, max: 1_000n }),
);

function atLeastZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

const factSets: fc.Arbitrary<AutoModeFacts> = fc
  .record({
    approvalMode: mostly<ApprovalMode>("auto", "manual"),
    modeVersion: fc.nat(),
    isInsideOwnPositions: fc.boolean(),
    valueUsdMicros: usd,
    perTradeHeadroom: headroom,
    dayHeadroom: headroom,
    rollingDaySpentUsdMicros: usd,
    hasUnlistedSpender: mostly(false, true),
  })
  .map((generated): AutoModeFacts => ({
    approvalMode: generated.approvalMode,
    modeVersion: generated.modeVersion,
    isInsideOwnPositions: generated.isInsideOwnPositions,
    valueUsdMicros: generated.valueUsdMicros,
    perTradeCapUsdMicros: atLeastZero(generated.valueUsdMicros + generated.perTradeHeadroom),
    rollingDayCapUsdMicros: atLeastZero(
      generated.rollingDaySpentUsdMicros + generated.valueUsdMicros + generated.dayHeadroom,
    ),
    rollingDaySpentUsdMicros: generated.rollingDaySpentUsdMicros,
    hasUnlistedSpender: generated.hasUnlistedSpender,
  }));

// Spec 6, section 5, written out independently of the module under test.
function isAllowedBySpec(subject: AutoModeSubject, given: AutoModeFacts): boolean {
  const isAutoKind =
    ["swap", "buy", "sell"].includes(subject.kind) ||
    (["lend", "stake"].includes(subject.kind) && given.isInsideOwnPositions);
  return (
    given.approvalMode === "auto" &&
    isAutoKind &&
    given.valueUsdMicros <= given.perTradeCapUsdMicros &&
    given.rollingDaySpentUsdMicros + given.valueUsdMicros <= given.rollingDayCapUsdMicros &&
    !given.hasUnlistedSpender &&
    !subject.hasOutsideContent &&
    subject.proposer === "agent_runtime"
  );
}

describe("the auto test as a property", () => {
  it("authorizes exactly the intents spec 6 allows and nothing else", () => {
    fc.assert(
      fc.property(subjects, factSets, (subject, generated) => {
        expect(checkAutoMode(subject, generated).ok).toBe(isAllowedBySpec(subject, generated));
      }),
    );
  });

  it("never authorizes a send, bridge, rescue, launch or approval change", () => {
    const neverAuto = fc.constantFrom(
      "send",
      "bridge",
      "rescue",
      "launchToken",
      "revokeApproval",
    ) satisfies fc.Arbitrary<AutoModeSubject["kind"]>;
    fc.assert(
      fc.property(subjects, neverAuto, factSets, (subject, kind, generated) => {
        expect(checkAutoMode({ ...subject, kind }, generated).ok).toBe(false);
      }),
    );
  });
});
