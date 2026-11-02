import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import type { CeilingRead } from "../install/ceiling-change.js";
import type { FakeCalls } from "./fake-ceiling-editor.js";

/** What a ceiling the fake holds allows when a test names nothing: no contract, one coin a call. */
export const oneCoin: FakeCalls = { contracts: [], perTxNativeBase: 10n ** 18n };

/** The chains of the accounts, each once, in the order they first appear. */
export function chainsOf(recipients: readonly AccountRef[]): readonly ChainRef[] {
  return [...new Set(recipients.map((account) => accountRefParts(account).chain))];
}

/** The accounts on the chains given: whom a ceiling's send rules list there. */
export function onEnabled(
  accounts: readonly AccountRef[],
  chains: readonly ChainRef[],
): readonly AccountRef[] {
  return accounts.filter((account) => chains.includes(accountRefParts(account).chain));
}

/** The accounts on any other chain: whom a ceiling's bridge rules pay there (decision 0313). */
export function offEnabled(
  accounts: readonly AccountRef[],
  chains: readonly ChainRef[],
): readonly AccountRef[] {
  return accounts.filter((account) => !chains.includes(accountRefParts(account).chain));
}

/** What a held ceiling's bridge rules reach, as the fake models them. */
export interface FakeBridges {
  /** The chains its bridge rules reach; every chain it does not enable when absent. */
  readonly reach?: readonly ChainRef[];
}

/**
 * A held ceiling as custody reads it: the chains it enables, whom its send rules list there, whom
 * its bridge rules pay on the chains they reach, and what its calls may do.
 */
export function readOf(
  accounts: readonly AccountRef[],
  chains: readonly ChainRef[],
  held: { readonly calls: FakeCalls; readonly bridges: FakeBridges },
): CeilingRead {
  const { calls, bridges } = held;
  const recipients = onEnabled(accounts, chains);
  const bridged = offEnabled(accounts, chains).filter(
    (account) => bridges.reach?.includes(accountRefParts(account).chain) ?? true,
  );
  const { contracts, perTxNativeBase } = calls;
  // Each function rides in the policy as a JSON ABI entry with no inputs, as a call rule holds it.
  const policy = jsonValueSchema.parse({
    chains: [...chains],
    contracts: [...contracts],
    perTxNativeBase: String(perTxNativeBase),
    recipients: [...recipients],
    bridged: [...bridged],
    dayCaps: (calls.dayCaps ?? []).map((cap) => ({
      asset: cap.asset,
      limit: String(cap.limit),
      windowSeconds: cap.windowSeconds,
      floorUsdMicros: String(cap.floorUsdMicros),
    })),
    launchCalls: [...(calls.launchCalls ?? [])],
    functions: (calls.functions ?? []).map((name) => ({ type: "function", name, inputs: [] })),
    ...(calls.ownCaps === undefined
      ? {}
      : {
          ownCaps: calls.ownCaps.map((cap) => ({
            functionName: cap.functionName,
            maxValueBase: String(cap.maxValueBase),
          })),
        }),
  });
  const { ownCaps } = calls;
  return {
    ...(ownCaps === undefined ? {} : { ownCaps }),
    chains,
    contracts,
    perTxNativeBase,
    recipients,
    bridged,
    dayCaps: calls.dayCaps ?? [],
    launchCalls: calls.launchCalls ?? [],
    functions: calls.functions ?? [],
    policy,
  };
}

const baseUnits = z.string().regex(/^\d+$/).transform(BigInt);

const storedSchema = z.object({
  chains: z.array(chainRefSchema),
  contracts: z.array(accountRefSchema),
  perTxNativeBase: baseUnits,
  recipients: z.array(accountRefSchema),
  bridged: z.array(accountRefSchema),
  dayCaps: z.array(
    z.object({
      asset: assetRefSchema,
      limit: baseUnits,
      windowSeconds: z.int(),
      floorUsdMicros: baseUnits,
    }),
  ),
  launchCalls: z.array(z.string()),
  functions: z.array(z.object({ name: z.string() })),
  ownCaps: z.array(z.object({ functionName: z.string(), maxValueBase: baseUnits })).optional(),
});

/** A stored copy of a ceiling the fake wrote, read as `readOf` reads it; undefined for another. */
export function readStoredOf(policy: JsonValue): CeilingRead | undefined {
  const parsed = storedSchema.safeParse(policy);
  if (!parsed.success) {
    return undefined;
  }
  const { functions, ownCaps, ...read } = parsed.data;
  const caps = ownCaps === undefined || ownCaps.length === 0 ? {} : { ownCaps };
  return { ...read, ...caps, functions: functions.map((item) => item.name), policy };
}
