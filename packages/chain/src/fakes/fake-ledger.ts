import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainHead, TxReceipt } from "../sending/tx-receipt.js";
import type { AssetTransfer } from "../simulation/simulated-step.js";
import { isTxHash, type TxHash } from "../transaction.js";
import { fakeTxHash } from "./fake-signing-scheme.js";

/** A signed fake transaction, read back from its raw text. */
export interface FakeSent {
  readonly hash: TxHash;
  readonly account: AccountRef;
  readonly nonce: number;
  /** The draft's payload the transaction was prepared from. */
  readonly draftPayload: string;
  readonly feePerGasBase: bigint;
  readonly raw: string;
}

/**
 * A fake chain's blocks for tests: the transactions relays took wait in a pool until `mine` puts
 * each one whose nonce is its sender's next into a block.
 */
export interface FakeLedger {
  readonly chain: ChainRef;
  /** Puts a transaction in the pool; `nonce_too_low` once a block holds its nonce. */
  pool(sent: FakeSent): "pooled" | "nonce_too_low";
  /** Mines `count` blocks, each holding every pooled transaction it can. */
  mine(count: number): void;
  /** Takes a transaction out of its block, as a reorg would: it waits in the pool again. */
  reorg(hash: TxHash): void;
  receipt(hash: TxHash): TxReceipt | undefined;
  /** What a transaction a block holds moved: none once it reverted; `undefined` while unmined. */
  transfers(hash: TxHash): readonly AssetTransfer[] | undefined;
  head(): ChainHead;
  /** The next nonce of an account: how many of its transactions blocks hold. */
  nextNonce(account: AccountRef): number;
  /** How many of an account's transactions the blocks up to and including `block` hold. */
  nonceAt(account: AccountRef, block: bigint): number;
  /**
   * The native coin an account's transactions that ran in a block received without a log, or
   * `undefined` once the state before the block is forgotten.
   */
  nativeReceived(account: AccountRef, block: bigint): bigint | undefined;
  /** Forgets the state of every block below `block`, as a node that prunes old state does. */
  forgetStateBelow(block: bigint): void;
}

/** What a fake ledger is made of. */
export interface FakeLedgerOptions {
  readonly chain: ChainRef;
  /** How many blocks below the latest are not final yet. */
  readonly finalityDepth: bigint;
  /** Draft payloads whose transactions revert in a block. */
  readonly reverting: ReadonlySet<string>;
  /** What a transaction that ran moved, by what it was sent as; nothing when absent. */
  readonly transfersOf?: (sent: FakeSent) => readonly AssetTransfer[];
  /** The native coin a transaction that ran received without a log; none when absent. */
  readonly nativeReceivedOf?: (sent: FakeSent) => bigint;
}

const gasUsed = 21_000n;
const nonceTextSchema = z.coerce.number().pipe(z.int().nonnegative());
const nonceTextPattern = /^\d{1,15}$/;

function unreadable(): BinferenceError {
  return new BinferenceError({
    code: "chain.bad_transaction",
    message: "The fake network cannot read these signed bytes.",
  });
}

/** Reads a fake signed transaction: `fake-signed|<sender>|<to>|<value>|<data>|<nonce>|<fee>`. */
export function readFakeSent(chain: ChainRef, raw: string): FakeSent {
  const [mark, sender, to, value, data, nonceText, fee, ...rest] = raw.split("|");
  const nonce = nonceTextSchema.safeParse(nonceText);
  const hash = fakeTxHash(raw);
  if (mark !== "fake-signed" || fee === undefined || rest.length > 0 || !nonce.success) {
    throw unreadable();
  }
  if (!nonceTextPattern.test(nonceText ?? "") || !isTxHash(hash)) {
    throw unreadable();
  }
  return {
    hash,
    account: accountRefSchema.parse(`${chain}:${sender ?? ""}`),
    nonce: nonce.data,
    draftPayload: [to, value, data].join("|"),
    feePerGasBase: BigInt(fee),
    raw,
  };
}

/** What a fake ledger holds: the pool, the blocks' receipts and each sender's next nonce. */
interface LedgerState {
  readonly options: FakeLedgerOptions;
  readonly pooled: Map<TxHash, FakeSent>;
  readonly mined: Map<TxHash, { readonly sent: FakeSent; readonly receipt: TxReceipt }>;
  readonly nonces: Map<AccountRef, number>;
}

function nextOf(state: LedgerState, account: AccountRef): number {
  return state.nonces.get(account) ?? 0;
}

function include(state: LedgerState, sent: FakeSent, number: bigint): void {
  const receipt: TxReceipt = {
    hash: sent.hash,
    block: { number, hash: `blk${number.toString()}` },
    status: state.options.reverting.has(sent.draftPayload) ? "reverted" : "success",
    gasUsed,
    feePerGasBase: sent.feePerGasBase,
  };
  state.mined.set(sent.hash, { sent, receipt });
  state.pooled.delete(sent.hash);
  state.nonces.set(sent.account, sent.nonce + 1);
}

// One block holds every pooled transaction whose nonce is its sender's next, in turn.
function mineAt(state: LedgerState, number: bigint): void {
  const ready = () =>
    [...state.pooled.values()].find((sent) => sent.nonce === nextOf(state, sent.account));
  for (let sent = ready(); sent !== undefined; sent = ready()) {
    include(state, sent, number);
  }
}

function reorgOne(state: LedgerState, hash: TxHash): void {
  const held = state.mined.get(hash);
  if (held !== undefined) {
    state.mined.delete(hash);
    state.pooled.set(hash, held.sent);
    state.nonces.set(held.sent.account, held.sent.nonce);
  }
}

// Blocks hold an account's transactions in nonce order, so the count is one past the highest nonce.
function nonceAt(state: LedgerState, account: AccountRef, block: bigint): number {
  const held = [...state.mined.values()].filter(
    ({ sent, receipt }) => sent.account === account && receipt.block.number <= block,
  );
  return held.reduce((next, { sent }) => Math.max(next, sent.nonce + 1), 0);
}

function transfersOf(state: LedgerState, hash: TxHash): readonly AssetTransfer[] | undefined {
  const held = state.mined.get(hash);
  if (held === undefined) {
    return undefined;
  }
  const isReverted = held.receipt.status === "reverted";
  return isReverted ? [] : (state.options.transfersOf?.(held.sent) ?? []);
}

// What the account's transactions that ran in the block received; the block before must be known.
function nativeReceived(
  state: LedgerState,
  query: { readonly account: AccountRef; readonly block: bigint; readonly forgotten: bigint },
): bigint | undefined {
  if (query.block - 1n < query.forgotten) {
    return undefined;
  }
  return [...state.mined.values()]
    .filter(({ sent, receipt }) => sent.account === query.account && receipt.status === "success")
    .filter(({ receipt }) => receipt.block.number === query.block)
    .reduce((sum, { sent }) => sum + (state.options.nativeReceivedOf?.(sent) ?? 0n), 0n);
}

/** Creates an empty {@link FakeLedger} at block 0. */
export function createFakeLedger(options: FakeLedgerOptions): FakeLedger {
  const state: LedgerState = { options, pooled: new Map(), mined: new Map(), nonces: new Map() };
  let latest = 0n;
  let forgotten = 0n;
  return {
    chain: options.chain,
    pool(sent) {
      if (sent.nonce < nextOf(state, sent.account) || state.mined.has(sent.hash)) {
        return "nonce_too_low";
      }
      state.pooled.set(sent.hash, sent);
      return "pooled";
    },
    mine(count) {
      for (let block = 0; block < count; block += 1) {
        latest += 1n;
        mineAt(state, latest);
      }
    },
    reorg: (hash) => {
      reorgOne(state, hash);
    },
    receipt: (hash) => state.mined.get(hash)?.receipt,
    transfers: (hash) => transfersOf(state, hash),
    head: () => ({
      latest,
      final: latest > options.finalityDepth ? latest - options.finalityDepth : 0n,
    }),
    nextNonce: (account) => nextOf(state, account),
    nonceAt: (account, block) => nonceAt(state, account, block),
    nativeReceived: (account, block) => nativeReceived(state, { account, block, forgotten }),
    forgetStateBelow(block) {
      forgotten = block;
    },
  };
}
