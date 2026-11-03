import { evmAccountRef, evmChainOf, encodeEvmDraft } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import type { JsonValue } from "@binference/core";
import {
  answerCall,
  type HubModel,
  logOf,
  type ModelValidator,
  runOnModel,
} from "@binference/stakehub/testing";
import {
  type Address,
  encodeAbiParameters,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
  toFunctionSelector,
  toHex,
  type TransactionSerialized,
} from "viem";
import { crashContract } from "./crash-market.js";
import { createModelHistory, type ModelHistory, wallSeconds } from "./crash-model-history.js";
import { scriptedMoveCode, scriptMove } from "./crash-scripted-moves.js";
import type { CrashStandIn, ViewAnswer, ViewCall } from "./crash-stand-ins.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

/** StakeHub at its BSC address, which the crash chain's scripted contract stands in for. */
export const crashStakeHub: Address = crashContract("stakehub", "stake-hub");

function addressOf(phrase: string): Address {
  return getAddress(keccak256(stringToHex(phrase)).slice(0, 42));
}

/** The one validator the crash chain's StakeHub lists, and its credit contract. */
export const crashValidator: { readonly operator: Address; readonly credit: Address } = {
  operator: addressOf("binference crash validator"),
  credit: addressOf("binference crash validator credit"),
};

/** The least stake the crash chain's StakeHub takes: 0.001 BNB, so a run's wallet can stake. */
const minDelegation = 10n ** 15n;
// The validator's pool before any run: 1,000 BNB for as many shares.
const pool = 1_000n * 10n ** 18n;

// A credit contract's ERC-20 reads, which StakeHub's model leaves out.
const creditTokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);
const tokenAnswers: ReadonlyMap<string, Hex> = new Map([
  [toFunctionSelector(creditTokenAbi[0]), encodeAbiParameters([{ type: "uint8" }], [18])],
  [toFunctionSelector(creditTokenAbi[1]), encodeAbiParameters([{ type: "string" }], ["stCRASH"])],
  [
    toFunctionSelector(creditTokenAbi[2]),
    encodeAbiParameters([{ type: "string" }], ["Stake Credit Crash"]),
  ],
]);

/** The crash chain's StakeHub: its stand-in, and the stakes a run's wallet holds before it starts. */
export interface CrashStakeHub {
  readonly standIn: CrashStakeHubStandIn;
  /**
   * Gives the wallet a stake with the validator, as a stake made earlier, and with `ready` an
   * unstake of that much coin whose unbonding ended.
   */
  readonly seed: (
    wallet: Address,
    held: { readonly staked: bigint; readonly ready?: bigint },
  ) => void;
  /** The coin of the wallet's unstakes waiting in the validator's queue. */
  readonly unbonding: (wallet: Address) => bigint;
}

/** The stand-in the crash chain serves for StakeHub and the validator's credit contract. */
type CrashStakeHubStandIn = CrashStandIn;

function modelValidator(): ModelValidator {
  return {
    ...crashValidator,
    moniker: "Crash Validator",
    commissionBps: 500n,
    jailed: false,
    jailUntil: 0n,
    supply: pool,
    pooled: pool,
    balances: new Map(),
    queues: new Map(),
    sequences: new Map(),
    rewards: new Map(),
  };
}

// StakeHub with the one validator, BSC's unbonding time and reward day, and the crash chain's
// least stake.
function modelOf(validator: ModelValidator): HubModel {
  return {
    validators: new Map([[validator.operator, validator]]),
    blocked: new Set(),
    coded: new Set(),
    reverting: new Set(),
    unbondPeriod: 7n * 86_400n,
    minDelegation,
    dayLength: 86_400n,
    flags: { paused: false },
    clock: { time: wallSeconds(), block: 0n },
  };
}

function viewOf(model: HubModel, call: ViewCall): ViewAnswer | undefined {
  if (call.to !== crashStakeHub && call.to !== crashValidator.credit) {
    return undefined;
  }
  const answer =
    answerCall(model, crashStakeHub, call) ??
    (call.to === crashValidator.credit ? tokenAnswers.get(call.data.slice(0, 10)) : undefined);
  return answer === undefined ? "revert" : { data: answer };
}

/** What a move reaches: anvil, the model, and the model's earlier states. */
interface HubParts {
  readonly anvil: AnvilCall;
  readonly model: HubModel;
  readonly history: ModelHistory<HubModel>;
}

// Makes the move on the model as StakeHub would, keeping the state before it, and scripts the
// contract to log it and pay a claim's coin when anvil runs the transaction.
async function moveOf(parts: HubParts, raw: TransactionSerialized) {
  const { anvil, model } = parts;
  const parsed = parseTransaction(raw);
  if (parsed.to === undefined || parsed.to === null || getAddress(parsed.to) !== crashStakeHub) {
    return;
  }
  const caller = await recoverTransactionAddress({ serializedTransaction: raw });
  const chain = evmChainOf(bsc);
  const draft = encodeEvmDraft({
    from: evmAccountRef(chain, caller),
    to: evmAccountRef(chain, crashStakeHub),
    value: parsed.value ?? 0n,
    data: parsed.data ?? "0x",
  });
  parts.history.moved(keccak256(raw), structuredClone(model));
  const event = runOnModel(model, crashStakeHub, draft);
  const log = logOf(crashStakeHub, event);
  const [event0, operator, delegator] = log.topics;
  if (event0 === undefined || operator === undefined || delegator === undefined) {
    return;
  }
  const payout = event.name === "Claimed" ? event.bnbAmount : 0n;
  const move = { topics: [event0, operator, delegator], data: log.data, payout } as const;
  await scriptMove(anvil, { contract: crashStakeHub, caller, move });
}

/**
 * Installs StakeHub on the bare crash chain: at its address, a scripted contract holding coin to
 * pay claims, and beside anvil a model of StakeHub with one validator, BSC's unbonding time and a
 * least stake of 0.001 BNB, which answers StakeHub's and the credit contract's views and makes
 * each move a relay passes on, once, before anvil runs it.
 */
export async function installCrashStakeHub(anvil: AnvilCall): Promise<CrashStakeHub> {
  await anvil("anvil_setCode", [crashStakeHub, scriptedMoveCode]);
  await anvil("anvil_setCode", [crashValidator.credit, "0x00"]);
  await anvil("anvil_setBalance", [crashStakeHub, toHex(10n ** 24n)]);
  const validator = modelValidator();
  const model = modelOf(validator);
  const history = createModelHistory<HubModel>(anvil);
  const current = (): ModelValidator => model.validators.get(crashValidator.operator) ?? validator;
  // The model's clock follows the wall clock, as anvil's new blocks do on the bare chain.
  const synced = (): HubModel => {
    model.clock.time = wallSeconds();
    return model;
  };
  return {
    standIn: {
      view: async (call) => viewOf(await history.at(call.block, synced()), call),
      beforeSend: async (raw) => moveOf({ anvil, model: synced(), history }, raw),
    },
    seed: (wallet, held) => {
      const now = current();
      const ready = held.ready ?? 0n;
      const request = { shares: ready, bnbAmount: ready, unlockTime: wallSeconds() - 3_600n };
      model.validators.set(crashValidator.operator, {
        ...now,
        supply: now.supply + held.staked,
        pooled: now.pooled + held.staked,
        balances: new Map(now.balances).set(wallet, held.staked),
        queues: new Map(now.queues).set(wallet, ready === 0n ? [] : [request]),
        sequences: new Map(now.sequences).set(wallet, ready === 0n ? 0n : 1n),
      });
    },
    unbonding: (wallet) =>
      (current().queues.get(wallet) ?? []).reduce((sum, request) => sum + request.bnbAmount, 0n),
  };
}
