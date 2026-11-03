import { bsc } from "@binference/chains";
import type { JsonValue } from "@binference/core";
import {
  answerView,
  createModel,
  type ListaModel,
  type ModelAddresses,
  runCall,
} from "@binference/lista/testing";
import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type TransactionSerialized,
} from "viem";
import { assemble, fail, op, p } from "./crash-assembler.js";
import { crashContract } from "./crash-market.js";
import { createModelHistory, wallSeconds } from "./crash-model-history.js";
import { crashStakeHub } from "./crash-stake-hub.js";
import type { CrashStandIn, ViewAnswer, ViewCall } from "./crash-stand-ins.js";
import { crashTokenCodeOf } from "./crash-token.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

// Lista's stake manager at its BSC address.
const crashStakeManager: Address = crashContract("lista", "stake-manager");

/** slisBNB at its BSC address, which only the crash chain's stake manager mints. */
export const crashSlisBnb: Address = getAddress(
  bsc.tokens.find(({ symbol }) => symbol === "slisBNB")?.address ?? "",
);
const multicall = getAddress(
  bsc.contracts.find(({ venue }) => venue === "multicall3")?.address ?? "",
);
const addresses: ModelAddresses = {
  manager: crashStakeManager,
  token: crashSlisBnb,
  stakeHub: crashStakeHub,
  multicall,
};

// The topic of the stake manager's `Deposit(address src, uint256 amount)`.
const depositTopic = BigInt(keccak256(toHex("Deposit(address,uint256)")));
// The pool before any run: 1,000 BNB for as many slisBNB, so a deposit mints a unit per wei.
const pool = 1_000n * 10n ** 18n;

/**
 * The runtime code of the crash chain's stake manager: a call with coin mints slisBNB to the
 * caller, a unit per wei, through slisBNB's `mint`, and logs `Deposit` of the caller and the coin;
 * a call without coin reverts.
 */
const managerCode: Hex = assemble([
  op.callValue,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  p(4, 0x40c10f19n),
  p(1, 0xe0n),
  op.shl,
  p(1, 0n),
  op.mstore,
  op.caller,
  p(1, 4n),
  op.mstore,
  op.callValue,
  p(1, 0x24n),
  op.mstore,
  p(1, 0n),
  p(1, 0n),
  p(1, 0x44n),
  p(1, 0n),
  p(1, 0n),
  p(20, BigInt(crashSlisBnb)),
  op.gas,
  op.call,
  op.isZero,
  { to: "fail" },
  op.jumpI,
  op.caller,
  p(1, 0n),
  op.mstore,
  op.callValue,
  p(1, 32n),
  op.mstore,
  p(32, depositTopic),
  p(1, 64n),
  p(1, 0n),
  op.log1,
  op.stop,
  ...fail,
]);

// The model's answer to a view of the stake manager or slisBNB; `undefined` for any other call.
function viewOf(model: ListaModel, call: ViewCall): ViewAnswer | undefined {
  if (call.to !== crashStakeManager && call.to !== crashSlisBnb) {
    return undefined;
  }
  const answer = answerView(model, addresses, call);
  return answer === undefined ? "revert" : { data: answer };
}

/** Lista's model on the crash chain as its latest block holds it. */
interface ListaState {
  model: ListaModel;
}

/**
 * Installs Lista on the bare crash chain: at their BSC addresses, the stake manager's code above
 * and slisBNB as the suite's ERC-20 that only the stake manager mints, and beside anvil a model of
 * the stake manager at a unit per wei, which answers its and slisBNB's views and makes each deposit
 * a relay passes on, once, before anvil runs it. Answers the stand-in the chain serves.
 */
export async function installCrashLista(anvil: AnvilCall): Promise<CrashStandIn> {
  await anvil("anvil_setCode", [crashStakeManager, managerCode]);
  await anvil("anvil_setCode", [crashSlisBnb, crashTokenCodeOf(crashStakeManager)]);
  const start = {
    supply: pool,
    pooled: pool,
    minBnb: 10n ** 15n,
    synFee: 1_500_000_000n,
    unbondPeriod: 7n * 86_400n,
    time: wallSeconds(),
  };
  const state: ListaState = { model: createModel(start) };
  const history = createModelHistory<ListaModel>(anvil);
  const move = async (raw: TransactionSerialized): Promise<void> => {
    const parsed = parseTransaction(raw);
    const to = parsed.to ?? undefined;
    if (to === undefined || getAddress(to) !== crashStakeManager) {
      return;
    }
    const from = await recoverTransactionAddress({ serializedTransaction: raw });
    const tx = {
      from,
      to: crashStakeManager,
      value: parsed.value ?? 0n,
      data: parsed.data ?? "0x",
    };
    history.moved(keccak256(raw), state.model);
    state.model = runCall({ ...state.model, time: wallSeconds() }, addresses, tx).model;
  };
  return {
    view: async (call) => viewOf(await history.at(call.block, state.model), call),
    beforeSend: move,
  };
}
