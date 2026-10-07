import { type Id, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import type { Sha256Hex } from "../records/sha256-hex.js";
import {
  type AutoModeGrant,
  type AutoModeGrantCheck,
  autoModeGrantSchema,
  autoModeKinds,
  checkAutoModeGrant,
} from "./auto-mode-grant.js";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const otherIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"int">;
const otherAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"agt">;
const terms = "a".repeat(64) as Sha256Hex;

const grant: AutoModeGrant = {
  approvalMode: "auto",
  agent: testAgent,
  intent,
  kind: "swap",
  modeVersion: 3,
  termsHash: terms,
  grantedAtMs: testNowMs,
  expiresAtMs: testNowMs + 60_000,
  networkFeeCapNativeBase: 1_000_000_000n,
};

const signing: AutoModeGrantCheck = {
  intent,
  termsHash: terms,
  approvalMode: { agentId: testAgent, mode: "auto", version: 3 },
  feePerGasNativeBase: 1_000_000_000n,
  nowMs: testNowMs + 59_999,
};

function problemOf(changes: Partial<AutoModeGrantCheck>, mode: object = {}) {
  const approvalMode = { ...signing.approvalMode, ...mode };
  const checked = checkAutoModeGrant(grant, { ...signing, ...changes, approvalMode });
  return checked.ok ? "holds" : checked.error;
}

describe("the auto grant", () => {
  it("holds for its intent and terms while the mode keeps its version, until it expires", () => {
    expect(checkAutoModeGrant(grant, signing)).toStrictEqual(ok(grant));
    expect(problemOf({ nowMs: testNowMs + 60_000 })).toBe("expired");
  });

  it("names a request for another intent, another agent or other terms", () => {
    expect(problemOf({ intent: otherIntent })).toBe("intent_mismatch");
    expect(problemOf({}, { agentId: otherAgent })).toBe("agent_mismatch");
    expect(problemOf({ termsHash: "b".repeat(64) as Sha256Hex })).toBe("terms_mismatch");
  });

  it("signs a transaction at the network fee cap per gas, and none above it", () => {
    expect(problemOf({ feePerGasNativeBase: 0n })).toBe("holds");
    expect(problemOf({ feePerGasNativeBase: 1_000_000_001n })).toBe("over_fee_cap");
  });

  it("ends once the agent is in manual mode or the mode changed in any way", () => {
    expect(problemOf({}, { mode: "manual" })).toBe("manual");
    expect(problemOf({}, { mode: "manual", version: 4 })).toBe("manual");
    expect(problemOf({}, { version: 5 })).toBe("mode_changed");
    expect(problemOf({}, { version: 2 })).toBe("mode_changed");
  });

  it("checks in the order its problems are listed", () => {
    const everything = {
      intent: otherIntent,
      termsHash: "b".repeat(64) as Sha256Hex,
      feePerGasNativeBase: 10n ** 12n,
      nowMs: testNowMs + 120_000,
    };
    const mode = { agentId: otherAgent, mode: "manual", version: 9 };
    expect(problemOf(everything, mode)).toBe("intent_mismatch");
    expect(problemOf({ ...everything, intent }, mode)).toBe("agent_mismatch");
    expect(problemOf({ ...everything, intent }, { ...mode, agentId: testAgent })).toBe("manual");
    expect(problemOf({ ...everything, intent }, { version: 9 })).toBe("mode_changed");
    expect(problemOf({ ...everything, intent })).toBe("terms_mismatch");
    expect(problemOf({ ...everything, intent, termsHash: terms })).toBe("over_fee_cap");
  });

  it("parses from the signer's JSON, and refuses a kind the auto mode never authorizes", () => {
    const json: unknown = JSON.parse(JSON.stringify(z.encode(autoModeGrantSchema, grant)));
    expect(json).toMatchObject({ networkFeeCapNativeBase: "1000000000" });
    expect(autoModeGrantSchema.parse(json)).toStrictEqual(grant);
    const allowed = autoModeKinds.filter(
      (kind) => autoModeGrantSchema.safeParse({ ...(json as object), kind }).success,
    );
    expect(allowed).toStrictEqual(["swap", "buy", "sell", "lend", "stake"]);
    const kinds = ["send", "bridge", "launchToken", "revokeApproval", "rescue", "cexOrder"];
    expect(
      kinds.filter((kind) => autoModeGrantSchema.safeParse({ ...grant, kind }).success),
    ).toStrictEqual([]);
    expect(autoModeGrantSchema.safeParse({ ...grant, approvalMode: "manual" }).success).toBe(false);
    expect(autoModeGrantSchema.safeParse({ ...grant, extra: true }).success).toBe(false);
  });
});
