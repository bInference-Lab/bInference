import {
  type AccountRef,
  accountRefParts,
  assetRefParts,
  type ChainEvent,
  type ChainRef,
  err,
  ok,
  type Result,
  type SettlementCheck,
} from "@binference/plugin-sdk";
import { type Address, decodeEventLog, type Hex, isHex, parseAbi } from "viem";
import { memoProgram, relayChainOf } from "../relay-chains.js";
import { lowerHex } from "../wire-values.schema.js";

// The events a Relay settlement is read from: the depository's deposit on the source chain, from
// Relay's EVM Depository reference, and the ERC-20 transfer by which Relay's solver pays a fill
// or a refund on an EVM chain.
const settlementEvents = parseAbi([
  "event RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

type Decoded = ReturnType<typeof decodeEventLog<typeof settlementEvents>>;

/** Relay's depository on each chain a deposit leaves from, as the registry lists it. */
type Depositories = Readonly<Partial<Record<ChainRef, AccountRef>>>;

// An SPL token amount is a u64: a fill on Solana whose memo names the deposit's order pays it all
// that the transaction brought the recipient.
const wholeSolanaPayment = 2n ** 64n - 1n;

// A Relay fill on Solana writes the order id it pays through the Memo program, as 32 bytes of hex.
const memoLine = /^Memo \(len \d+\): "(0x[0-9a-fA-F]{64})"$/u;

function isHexList(values: readonly string[]): values is readonly Hex[] {
  return values.every((value) => isHex(value));
}

// The events of one transaction that `emitter` emitted, decoded; any other is skipped.
function eventsOf(events: readonly ChainEvent[], emitter: string): readonly Decoded[] {
  const own = emitter.toLowerCase();
  return events.flatMap((event) => {
    const [selector, ...rest] = event.topics;
    const isEmitter = accountRefParts(event.emitter).address.toLowerCase() === own;
    if (
      !isEmitter ||
      selector === undefined ||
      !isHex(selector) ||
      !isHexList(rest) ||
      !isHex(event.data)
    ) {
      return [];
    }
    try {
      return [
        decodeEventLog({ abi: settlementEvents, topics: [selector, ...rest], data: event.data }),
      ];
    } catch {
      return [];
    }
  });
}

const addressOf = (account: AccountRef): string => accountRefParts(account).address.toLowerCase();

// The order the deposit paid, from the depository's own `RelayErc20Deposit`: from the wallet, of
// exactly the token and amount sent.
function orderPaid(check: SettlementCheck, depositories: Depositories): Hex | undefined {
  const depository = depositories[check.deposit.ref.chain];
  const token = assetRefParts(check.amountIn.asset).assetReference.toLowerCase();
  const found = eventsOf(
    check.deposit.events,
    depository === undefined ? "" : addressOf(depository),
  ).find(
    (event) =>
      event.eventName === "RelayErc20Deposit" &&
      event.args.from.toLowerCase() === addressOf(check.wallet) &&
      event.args.token.toLowerCase() === token &&
      event.args.amount === check.amountIn.base,
  );
  return found?.eventName === "RelayErc20Deposit" ? lowerHex(found.args.id) : undefined;
}

// What Relay's solver paid `to` in `token` by the token's own transfer events, on an EVM chain.
function solverPaid(
  events: readonly ChainEvent[],
  paid: { readonly token: string; readonly to: string; readonly solver: Address },
): bigint {
  const { token, to } = paid;
  return eventsOf(events, token).reduce(
    (sum, event) =>
      event.eventName === "Transfer" &&
      event.args.from.toLowerCase() === paid.solver.toLowerCase() &&
      event.args.to.toLowerCase() === to
        ? sum + event.args.value
        : sum,
    0n,
  );
}

// Whether a Solana transaction's Memo program wrote the order's id.
function memoNames(check: SettlementCheck, orderId: Hex): boolean {
  return check.settlement.events.some((event) => {
    const isMemo = accountRefParts(event.emitter).address === memoProgram;
    const named = isMemo && event.topics[0] === "log" ? memoLine.exec(event.data)?.[1] : undefined;
    return named !== undefined && lowerHex(named) === orderId;
  });
}

// What the fill paid this deposit's recipient: on an EVM chain the delivered token Relay's solver
// sent the recipient, never more than the order's least output, which with no slippage is all it
// pays, so another order's payment in the same transaction never counts here; on Solana the whole
// payment, when its memo names the deposit's order.
function filledOf(
  check: SettlementCheck,
  paid: { readonly orderId: Hex; readonly solver: Address },
): bigint {
  const { orderId, solver } = paid;
  const chain = relayChainOf(check.settlement.ref.chain);
  if (chain?.vm === "svm") {
    return memoNames(check, orderId) ? wholeSolanaPayment : 0n;
  }
  const token = assetRefParts(check.minOut.asset).assetReference.toLowerCase();
  const sent =
    chain === undefined
      ? 0n
      : solverPaid(check.settlement.events, { token, to: addressOf(check.recipient), solver });
  return sent < check.minOut.base ? sent : check.minOut.base;
}

// What the refund paid the wallet back: the token sent, by Relay's solver, never more than sent.
function refundedOf(check: SettlementCheck, solver: Address): bigint {
  const token = assetRefParts(check.amountIn.asset).assetReference.toLowerCase();
  const paid = solverPaid(check.settlement.events, { token, to: addressOf(check.wallet), solver });
  return paid < check.amountIn.base ? paid : check.amountIn.base;
}

/**
 * Matches a fill or refund to its Relay deposit by the chains' own events (decisions 0320 and
 * 0323): the depository's `RelayErc20Deposit` on the source chain, from the wallet, of exactly the
 * token and amount sent, names the order. On Solana a fill counts only when its Memo program names
 * that order, and pays all the transaction brought the recipient. On an EVM chain Relay's fill
 * names the order only in its calldata, which no event carries: a fill counts what Relay's solver
 * sent the recipient in the delivered token by that token's transfer events, never more than the
 * least output, and a refund what it sent the wallet back in the token sent, never more than the
 * deposit. Anything else, a transfer from anyone but the solver among it, is `not_own`.
 */
export function relaySettlement(
  check: SettlementCheck,
  parts: { readonly depositories: Depositories; readonly solver: Address },
): Result<bigint, "not_own"> {
  const { solver } = parts;
  const orderId = orderPaid(check, parts.depositories);
  if (orderId === undefined) {
    return err("not_own");
  }
  const paid =
    check.kind === "fill" ? filledOf(check, { orderId, solver }) : refundedOf(check, solver);
  return paid > 0n ? ok(paid) : err("not_own");
}
