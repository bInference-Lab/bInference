import { BinferenceError, type TxDraft } from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, decodeFunctionData, getAddress, parseAbi } from "viem";

/** One waiting unstake. */
interface ModelRequest {
  readonly shares: bigint;
  readonly bnbAmount: bigint;
  readonly unlockTime: bigint;
}

/** One validator of a StakeHub model and its credit contract's pool. */
export interface ModelValidator {
  readonly operator: Address;
  readonly credit: Address;
  readonly moniker: string;
  readonly commissionBps: bigint;
  readonly jailed: boolean;
  readonly jailUntil: bigint;
  /** The credit contract's shares, and the coin its pool holds. */
  readonly supply: bigint;
  readonly pooled: bigint;
  readonly balances: ReadonlyMap<Address, bigint>;
  readonly queues: ReadonlyMap<Address, readonly ModelRequest[]>;
  /** Per delegator, the sequence number its next unstake takes. */
  readonly sequences: ReadonlyMap<Address, bigint>;
  /** Per reward day: the rewards, and the pool before them. */
  readonly rewards: ReadonlyMap<bigint, { readonly reward: bigint; readonly pooled: bigint }>;
}

/** StakeHub's state, as its contracts keep it: each validator by operator, in listing order. */
export interface HubModel {
  readonly validators: Map<Address, ModelValidator>;
  readonly blocked: Set<Address>;
  /** Wallets that hold code, which StakeHub's 5,000 gas payment of a claim cannot reach. */
  readonly coded: Set<Address>;
  /** Views that revert for every caller, as a node's gas cap can make a long one revert. */
  readonly reverting: Set<string>;
  readonly unbondPeriod: bigint;
  readonly minDelegation: bigint;
  readonly dayLength: bigint;
  readonly flags: { paused: boolean };
  readonly clock: { time: bigint; block: bigint };
}

/** The event a move writes, as StakeHub writes it. */
export interface ModelEvent {
  readonly name: "Delegated" | "Undelegated" | "Claimed";
  readonly operator: Address;
  readonly delegator: Address;
  readonly shares?: bigint;
  readonly bnbAmount: bigint;
}

/** A validator after a move, and the event the move wrote. */
interface Moved {
  readonly validator: ModelValidator;
  readonly event: ModelEvent;
}

/** One move a wallet makes on a validator. */
interface Move {
  readonly from: Address;
  readonly validator: ModelValidator;
  /** The coin a stake sends, the shares an unstake burns, the parts a claim takes. */
  readonly amount: bigint;
}

// The three user moves, written here apart from the plugin's own encoders.
const movesAbi = parseAbi([
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
]);

/** A revert of the model, named as StakeHub's own error. */
function reverted(name: string): BinferenceError {
  return new BinferenceError({ code: "world.reverted", message: `StakeHub reverted: ${name}.` });
}

function delegate(model: HubModel, { from, validator, amount }: Move): Moved {
  if (amount < model.minDelegation) {
    throw reverted("DelegationAmountTooSmall");
  }
  if (validator.jailed && from !== validator.operator) {
    throw reverted("OnlySelfDelegation");
  }
  const shares = validator.supply === 0n ? amount : (amount * validator.supply) / validator.pooled;
  const balances = new Map(validator.balances).set(
    from,
    (validator.balances.get(from) ?? 0n) + shares,
  );
  const changed = {
    ...validator,
    balances,
    supply: validator.supply + shares,
    pooled: validator.pooled + amount,
  };
  const event = {
    name: "Delegated",
    operator: validator.operator,
    delegator: from,
    shares,
    bnbAmount: amount,
  } as const;
  return { validator: changed, event };
}

function undelegate(model: HubModel, { from, validator, amount: shares }: Move): Moved {
  const held = validator.balances.get(from) ?? 0n;
  if (shares === 0n || shares > held) {
    throw reverted(shares === 0n ? "ZeroShares" : "InsufficientBalance");
  }
  const bnbAmount = (shares * validator.pooled) / validator.supply;
  const request = { shares, bnbAmount, unlockTime: model.clock.time + model.unbondPeriod };
  const changed = {
    ...validator,
    balances: new Map(validator.balances).set(from, held - shares),
    queues: new Map(validator.queues).set(from, [...(validator.queues.get(from) ?? []), request]),
    sequences: new Map(validator.sequences).set(from, (validator.sequences.get(from) ?? 0n) + 1n),
    supply: validator.supply - shares,
    pooled: validator.pooled - bnbAmount,
  };
  const event = {
    name: "Undelegated",
    operator: validator.operator,
    delegator: from,
    shares,
    bnbAmount,
  } as const;
  return { validator: changed, event };
}

function claim(model: HubModel, { from, validator, amount: parts }: Move): Moved {
  const queue = validator.queues.get(from) ?? [];
  if (queue.length === 0) {
    throw reverted("NoUnbondRequest");
  }
  const wanted = parts === 0n || parts > BigInt(queue.length) ? queue.length : Number(parts);
  const locked = queue.findIndex((request) => request.unlockTime > model.clock.time);
  const taken = Math.min(wanted, locked === -1 ? queue.length : locked);
  if (taken === 0) {
    throw reverted("NoClaimableUnbondRequest");
  }
  if (model.coded.has(from)) {
    throw reverted("TransferFailed");
  }
  const bnbAmount = queue.slice(0, taken).reduce((sum, request) => sum + request.bnbAmount, 0n);
  const changed = { ...validator, queues: new Map(validator.queues).set(from, queue.slice(taken)) };
  const event = {
    name: "Claimed",
    operator: validator.operator,
    delegator: from,
    bnbAmount,
  } as const;
  return { validator: changed, event };
}

/**
 * Runs a StakeHub call from the draft's sender as StakeHub does, reverting as it reverts: paused,
 * a refused account, an unknown validator, a small or jailed delegation, zero or too many shares,
 * nothing to claim, a payment a wallet with code cannot take. A call to another contract, or
 * another function, reverts. Answers the event the move wrote.
 */
export function runOnModel(model: HubModel, hub: Address, draft: TxDraft): ModelEvent {
  const call = decodeEvmDraft(draft);
  if (!call.ok || call.value.to !== hub) {
    throw reverted("not StakeHub");
  }
  const { from, value, data } = call.value;
  if (model.flags.paused || model.blocked.has(from)) {
    throw reverted(model.flags.paused ? "AlreadyPaused" : "InBlackList");
  }
  const move = decodeFunctionData({ abi: movesAbi, data });
  const validator = model.validators.get(getAddress(move.args[0]));
  if (validator === undefined) {
    throw reverted("ValidatorNotExisted");
  }
  const changed =
    move.functionName === "delegate"
      ? delegate(model, { from, validator, amount: value })
      : (move.functionName === "undelegate" ? undelegate : claim)(model, {
          from,
          validator,
          amount: move.args[1],
        });
  model.validators.set(validator.operator, changed.validator);
  return changed.event;
}
