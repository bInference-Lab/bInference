import { BinferenceError, err, ok, type Result } from "@binference/core";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import { assetRefParts, assetRefSchema } from "../caip/asset-ref.js";
import { type ChainRef, chainRefParts } from "../caip/chain-ref.js";
import type { DraftCall, TokenApproval } from "../draft-call.js";
import type { ChainFamily } from "../ports.js";
import type { TokenTransfer } from "../token-transfer.js";
import type { TxDraft } from "../transaction.js";
import { fakeCallOf, fakeDraft, isFakeAddress, isFakeUnsigned } from "./fake-draft.js";

const namespace = "fake";
// The asset namespaces of the fake family's tokens and of each chain's coin.
const tokenNamespace = "token";
const coinNamespace = "slip44";

function parseAddress(text: string): Result<string, "malformed_address"> {
  return isFakeAddress(text) ? ok(text.toLowerCase()) : err("malformed_address");
}

// `approve,<spender>,<amount>` to a token is the fake family's token approval.
function approvalOf(draft: TxDraft, token: string, data: string): TokenApproval | undefined {
  const [spender = "", amount = "", ...rest] = data.split(",").slice(1);
  if (rest.length > 0 || !isFakeAddress(spender) || !isFakeUnsigned(amount)) {
    return undefined;
  }
  return {
    asset: assetRefSchema.parse(`${draft.chain}/token:${token}`),
    spender: accountRefSchema.parse(`${draft.chain}:${spender.toLowerCase()}`),
    amountBase: BigInt(amount),
  };
}

function readDraft(draft: TxDraft): Result<DraftCall, "malformed_draft"> {
  const call = fakeCallOf(draft);
  if (call === undefined || chainRefParts(draft.chain).namespace !== namespace) {
    return err("malformed_draft");
  }
  const to = call.to.toLowerCase();
  const target = accountRefSchema.parse(`${draft.chain}:${to}`);
  if (!call.data.startsWith("approve,")) {
    return ok({ target, nativeValue: call.value });
  }
  const approval = approvalOf(draft, to, call.data);
  return approval === undefined
    ? err("malformed_draft")
    : ok({ target, nativeValue: call.value, approval });
}

// The fake family's addresses are 4 bytes, the first four of the seed.
function freshAccount(chain: ChainRef, seed: Readonly<Uint8Array>): AccountRef {
  if (seed.length < 32) {
    throw new BinferenceError({
      code: "chain.short_seed",
      message: "A fresh account needs at least 32 random bytes.",
    });
  }
  const address = Buffer.from(seed.subarray(0, 4)).toString("hex");
  return accountRefSchema.parse(`${chain}:0x${address}`);
}

// The coin goes as a call with no data to the recipient; `transfer,<to>,<amount>` to a token is
// the fake family's token transfer.
function transferDraft(transfer: TokenTransfer): Result<TxDraft, "unknown_asset"> {
  const { from, to, amount } = transfer;
  const asset = assetRefParts(amount.asset);
  const chain = accountRefParts(from).chain;
  const recipient = accountRefParts(to).address;
  if (asset.chain === chain && asset.assetNamespace === coinNamespace) {
    return ok(fakeDraft(from, { to: recipient, value: amount.base, data: "" }));
  }
  if (
    asset.chain !== chain ||
    asset.assetNamespace !== tokenNamespace ||
    !isFakeAddress(asset.assetReference)
  ) {
    return err("unknown_asset");
  }
  const data = ["transfer", recipient, amount.base.toString()].join(",");
  return ok(fakeDraft(from, { to: asset.assetReference, value: 0n, data }));
}

/**
 * Creates a chain family for tests: namespace `fake`, addresses of 8 hex digits after `0x`,
 * canonical in lowercase. Its drafts are `<to>|<value>|<data>` (see `fakeDraft`), and data that
 * starts with `approve,` is a token approval of the `token` asset namespace. A fresh account takes
 * the first 4 bytes of its seed, and a token transfer is `transfer,<to>,<amount>` to the token; a
 * send of the coin is a call with no data to the recipient.
 */
export function createFakeFamily(): ChainFamily {
  return {
    id: "fake",
    namespace,
    tokenNamespace,
    parseAddress,
    readDraft,
    freshAccount,
    transferDraft,
  };
}
