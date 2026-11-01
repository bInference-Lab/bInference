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
import { eip155ChainIdOf } from "@binference/plugin-sdk/evm";
import { decodeEventLog, type Hex, isHex, pad, parseAbi } from "viem";

// The SpokePool's events a settlement is read from, as Across's V3 SpokePool interface declares
// them: the deposit on the source chain, its fill on the destination, and the relayer refund leaf
// that pays an expired deposit back on the source chain.
const spokePoolEvents = parseAbi([
  "event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)",
  "event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)",
  "event ExecutedRelayerRefundRoot(uint256 amountToReturn, uint256 indexed chainId, uint256[] refundAmounts, uint32 indexed rootBundleId, uint32 indexed leafId, address l2TokenAddress, address[] refundAddresses, bool deferredRefunds, address caller)",
]);

type Decoded = ReturnType<typeof decodeEventLog<typeof spokePoolEvents>>;

/** The SpokePool on each chain a deposit leaves from or a fill lands on, as the registry lists it. */
type SpokePools = Readonly<Partial<Record<ChainRef, AccountRef>>>;

/** What the deposit's own event says: which deposit it is, and what it must deliver to whom. */
interface Deposited {
  readonly depositId: bigint;
  /** The depositor, the recipient and both tokens as lowercase 32-byte words. */
  readonly depositor: string;
  readonly recipient: string;
  readonly inputToken: string;
  readonly outputToken: string;
}

// An address as Across's events write it: a 32-byte word, its 20 bytes at the right, lowercase.
function wordOf(address: string): string | undefined {
  return isHex(address) && address.length === 42 ? pad(address).toLowerCase() : undefined;
}

const accountWord = (account: AccountRef): string | undefined =>
  wordOf(accountRefParts(account).address);

// A chain's EIP-155 id as Across's events write it; none for a chain outside EIP-155.
function chainIdOf(chain: ChainRef): bigint | undefined {
  const id = eip155ChainIdOf(chain);
  return id === undefined ? undefined : BigInt(id);
}

function isHexList(values: readonly string[]): values is readonly Hex[] {
  return values.every((value) => isHex(value));
}

// An event's topics and data as viem reads a log, when every part is hex and a selector leads.
function logOf(
  event: ChainEvent,
): { readonly topics: [Hex, ...Hex[]]; readonly data: Hex } | undefined {
  const { topics, data } = event;
  const [selector, ...rest] = topics;
  if (selector === undefined || !isHex(selector) || !isHexList(rest) || !isHex(data)) {
    return undefined;
  }
  return { topics: [selector, ...rest], data };
}

// The events of one transaction that the chain's SpokePool emitted, decoded; any other is skipped.
function poolEvents(
  events: readonly ChainEvent[],
  pool: AccountRef | undefined,
): readonly Decoded[] {
  const own = pool === undefined ? undefined : accountRefParts(pool).address.toLowerCase();
  return events.flatMap((event) => {
    const log = logOf(event);
    if (
      own === undefined ||
      log === undefined ||
      accountRefParts(event.emitter).address.toLowerCase() !== own
    ) {
      return [];
    }
    try {
      return [decodeEventLog({ abi: spokePoolEvents, ...log })];
    } catch {
      return [];
    }
  });
}

// The deposit's own `FundsDeposited`: from the wallet, of exactly the amount sent in its token, to
// the recipient on the recipient's chain.
function depositedOf(check: SettlementCheck, pools: SpokePools): Deposited | undefined {
  const { deposit, wallet, amountIn, recipient } = check;
  const destination = chainIdOf(accountRefParts(recipient).chain);
  const tokenIn = wordOf(assetRefParts(amountIn.asset).assetReference);
  const found = poolEvents(deposit.events, pools[deposit.ref.chain]).find(
    (event) =>
      event.eventName === "FundsDeposited" &&
      event.args.depositor.toLowerCase() === accountWord(wallet) &&
      event.args.recipient.toLowerCase() === accountWord(recipient) &&
      event.args.inputToken.toLowerCase() === tokenIn &&
      event.args.inputAmount === amountIn.base &&
      event.args.destinationChainId === destination,
  );
  if (found?.eventName !== "FundsDeposited") {
    return undefined;
  }
  const { args } = found;
  return {
    depositId: args.depositId,
    depositor: args.depositor.toLowerCase(),
    recipient: args.recipient.toLowerCase(),
    inputToken: args.inputToken.toLowerCase(),
    outputToken: args.outputToken.toLowerCase(),
  };
}

// What the deposit's own `FilledRelay` paid its recipient on the destination's SpokePool: the
// fill names the deposit's origin chain, id, depositor, recipient and output token, and the
// recipient it paid is the deposit's own.
function filledOf(
  check: SettlementCheck,
  pools: SpokePools,
  deposited: Deposited,
): bigint | undefined {
  const origin = chainIdOf(check.deposit.ref.chain);
  const tokenOut = wordOf(assetRefParts(check.minOut.asset).assetReference);
  const found = poolEvents(check.settlement.events, pools[check.settlement.ref.chain]).find(
    (event) =>
      event.eventName === "FilledRelay" &&
      event.args.originChainId === origin &&
      event.args.depositId === deposited.depositId &&
      event.args.depositor.toLowerCase() === deposited.depositor &&
      event.args.recipient.toLowerCase() === deposited.recipient &&
      event.args.relayExecutionInfo.updatedRecipient.toLowerCase() === deposited.recipient &&
      event.args.outputToken.toLowerCase() === deposited.outputToken &&
      deposited.outputToken === tokenOut,
  );
  return found?.eventName === "FilledRelay"
    ? found.args.relayExecutionInfo.updatedOutputAmount
    : undefined;
}

// What a relayer refund leaf on the source chain's SpokePool paid the depositor back of the token
// sent: Across sums an address's refunds in one leaf and names no deposit, so a leaf counts only
// when it pays the depositor at least the deposit's input, and it pays back the input alone.
function refundedOf(
  check: SettlementCheck,
  pools: SpokePools,
  deposited: Deposited,
): bigint | undefined {
  const chainId = chainIdOf(check.settlement.ref.chain);
  const depositor = deposited.depositor.slice(-40);
  const tokenIn = deposited.inputToken.slice(-40);
  const paid = poolEvents(check.settlement.events, pools[check.settlement.ref.chain]).some(
    (event) =>
      event.eventName === "ExecutedRelayerRefundRoot" &&
      event.args.chainId === chainId &&
      !event.args.deferredRefunds &&
      event.args.l2TokenAddress.slice(2).toLowerCase() === tokenIn &&
      event.args.refundAddresses.some(
        (address, index) =>
          address.slice(2).toLowerCase() === depositor &&
          (event.args.refundAmounts[index] ?? 0n) >= check.amountIn.base,
      ),
  );
  return paid ? check.amountIn.base : undefined;
}

/**
 * Matches a fill or refund to its Across deposit by the SpokePools' own events (decision 0320):
 * the deposit's `FundsDeposited` on the source chain's SpokePool, from the wallet, of exactly the
 * amount sent, to the recipient; for a fill, the destination SpokePool's `FilledRelay` of that
 * deposit's id from that origin chain, to that recipient in the route's token, paying its updated
 * output; for a refund, the source SpokePool's relayer refund leaf paying the depositor at least
 * the input, which pays back the input alone. Anything else, a bare transfer among it, is
 * `not_own`.
 */
export function acrossSettlement(
  check: SettlementCheck,
  pools: SpokePools,
): Result<bigint, "not_own"> {
  const deposited = depositedOf(check, pools);
  if (deposited === undefined) {
    return err("not_own");
  }
  const paid =
    check.kind === "fill" ? filledOf(check, pools, deposited) : refundedOf(check, pools, deposited);
  return paid === undefined ? err("not_own") : ok(paid);
}
