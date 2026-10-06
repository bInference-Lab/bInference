import { err, ok, type Result } from "@binference/core";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefParts } from "../caip/chain-ref.js";
import type { DraftCall, TokenApproval } from "../draft-call.js";
import type { ChainFamily } from "../ports.js";
import type { TxDraft } from "../transaction.js";
import { fakeCallOf, isFakeAddress, isFakeUnsigned } from "./fake-draft.js";

const namespace = "fake";

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

/**
 * Creates a chain family for tests: namespace `fake`, addresses of 8 hex digits after `0x`,
 * canonical in lowercase. Its drafts are `<to>|<value>|<data>` (see `fakeDraft`), and data that
 * starts with `approve,` is a token approval of the `token` asset namespace.
 */
export function createFakeFamily(): ChainFamily {
  return { id: "fake", namespace, parseAddress, readDraft };
}
