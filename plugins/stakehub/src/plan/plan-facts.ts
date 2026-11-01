import {
  type Bps,
  bpsSchema,
  err,
  ok,
  type Result,
  type StakeRefusal,
  type StakeRequest,
} from "@binference/plugin-sdk";
import { type Address, zeroAddress } from "viem";
import {
  commissionRead,
  creditRead,
  creditTotalRead,
  hubFlagRead,
  jailRead,
  monikerRead,
} from "../hub/hub-calls.js";
import { readEach, required, unreadable } from "../hub/hub-read.js";
import { type HubNumbers, type OptionsRead, readHubNumbers } from "../hub/read-options.js";

/** The request with its wallet and validator as EVM addresses. */
export interface PlanAsk {
  readonly request: StakeRequest;
  readonly wallet: Address;
  readonly validator: Address;
}

/** What StakeHub says of the validator at the plan's block, and its credit contract's pool. */
export interface Facts {
  readonly name: string;
  readonly commissionBps: Bps;
  readonly jailed: boolean;
  readonly credit: Address;
  readonly numbers: HubNumbers;
  /** The credit contract's shares, and the coin its pool holds. */
  readonly supply: bigint;
  readonly pooled: bigint;
}

// StakeHub's pause, and its refusal of the wallet unless the plan is a paper one, which reads
// nothing of the wallet's own.
async function readGates(at: OptionsRead, ask: PlanAsk): Promise<StakeRefusal | undefined> {
  const isPaper = ask.request.paper !== undefined;
  const flags = [hubFlagRead(at.hub), ...(isPaper ? [] : [hubFlagRead(at.hub, ask.wallet)])];
  const [paused, blocked] = await readEach(at, flags);
  if (required(paused, "isPaused")) {
    return "staking_paused";
  }
  return !isPaper && required(blocked, "blackList") ? "wallet_blocked" : undefined;
}

// The validator's moniker, commission and jail state, read once its credit contract shows that
// StakeHub lists it: a revert of any of them then is a fault.
async function readValidator(
  at: OptionsRead,
  validator: Address,
): Promise<Pick<Facts, "name" | "commissionBps" | "jailed">> {
  const { hub } = at;
  const [[name], [rate], [jail]] = await Promise.all([
    readEach(at, [monikerRead(hub, validator)]),
    readEach(at, [commissionRead(hub, validator)]),
    readEach(at, [jailRead(hub, validator)]),
  ]);
  const commission = bpsSchema.safeParse(Number(required(rate, "getValidatorCommission")));
  if (!commission.success) {
    throw unreadable("a validator's commission is above 100%.");
  }
  const { jailed } = required(jail, "getValidatorBasicInfo");
  return {
    name: required(name, "getValidatorDescription"),
    commissionBps: commission.data,
    jailed,
  };
}

async function readPool(
  at: OptionsRead,
  credit: Address,
): Promise<Pick<Facts, "supply" | "pooled">> {
  const [supply, pooled] = await readEach(at, [
    creditTotalRead(credit, "totalSupply"),
    creditTotalRead(credit, "totalPooledBNB"),
  ]);
  return { supply: required(supply, "totalSupply"), pooled: required(pooled, "totalPooledBNB") };
}

/**
 * Reads what a plan rests on at the read's block, in the order StakeHub checks it: paused
 * (`staking_paused`), a black-listed wallet (`wallet_blocked`, never for a paper plan), an operator
 * it does not list (`validator_unknown`, a zero credit contract alone); then the validator's
 * moniker, commission and jail state, StakeHub's numbers, and the credit contract's pool.
 */
export async function readFacts(
  at: OptionsRead,
  ask: PlanAsk,
): Promise<Result<Facts, StakeRefusal>> {
  const [gate, [credit]] = await Promise.all([
    readGates(at, ask),
    readEach(at, [creditRead(at.hub, ask.validator)]),
  ]);
  if (gate !== undefined) {
    return err(gate);
  }
  const contract = required(credit, "getValidatorCreditContract");
  if (contract === zeroAddress) {
    return err("validator_unknown");
  }
  const [validator, numbers, pool] = await Promise.all([
    readValidator(at, ask.validator),
    readHubNumbers(at, at.hub),
    readPool(at, contract),
  ]);
  return ok({ ...validator, ...pool, credit: contract, numbers });
}
