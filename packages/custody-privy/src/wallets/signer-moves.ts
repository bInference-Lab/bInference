import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId, WalletRecord } from "../privy/privy-records.js";
import type { SignerEntry } from "../privy/wallet-signers.js";
import type { OwnerAuthorize } from "./rule-plans.js";

/** A wallet whose signer moves: Privy's id of it, and of the ceiling that binds its signer. */
export interface SignedWallet {
  readonly wallet: PrivyId;
  readonly policy: PrivyId;
}

/** How a move is signed: by the owner key, each change expiring at `expiresAtMs`. */
export interface SignerMoveInput extends CallOptions {
  readonly authorize: OwnerAuthorize;
  readonly expiresAtMs: number;
}

/** Why a signer could not become each wallet's one signer. */
export type SignerSwapRefusal =
  /** The owner key did not sign, or Privy did not take its signature as the wallet owner's. */
  | "refused"
  /** Privy holds no such wallet. */
  | "not_found";

/** Why a signer could not leave the wallets. */
export type SignerRemovalRefusal =
  | SignerSwapRefusal
  /** No wallet lists the signer. */
  | "not_signer"
  /** A wallet would keep no signer: it lists this one alone. */
  | "last_signer";

function entriesOf(record: WalletRecord): readonly SignerEntry[] {
  return record.signers.map((item) => ({
    signer: item.signerId,
    policies: item.overridePolicyIds ?? [],
  }));
}

const byText = (left: string, right: string): number => left.localeCompare(right);

// One text per set of ids, whatever their order.
function idsText(ids: readonly string[]): string {
  return ids.toSorted(byText).join(",");
}

// One text per set of signers, each with its set of policies, whatever their order.
function textOf(entries: readonly SignerEntry[]): string {
  return idsText(entries.map((entry) => `${entry.signer}:${idsText(entry.policies)}`));
}

// Privy's wallet as it reads now must hold its owner and policies, with exactly these signers.
async function readBack(
  api: PrivyApi,
  expected: { readonly before: WalletRecord; readonly signers: readonly SignerEntry[] },
  options: CallOptions,
): Promise<void> {
  const { before, signers } = expected;
  const after = await api.wallet(before.id, options);
  const isAsAsked =
    after.ok &&
    after.value.ownerId === before.ownerId &&
    idsText(after.value.policyIds) === idsText(before.policyIds) &&
    textOf(entriesOf(after.value)) === textOf(signers);
  if (!isAsAsked) {
    throw new BinferenceError({
      code: "custody.signers_read_back",
      message: "Privy read a wallet back with other signers, owner or policies than were set.",
      details: { wallet: before.id },
    });
  }
}

// Sets one wallet's signers, signed by the owner key, then reads it back.
async function setSigners(
  api: PrivyApi,
  target: { readonly before: WalletRecord; readonly signers: readonly SignerEntry[] },
  input: SignerMoveInput,
): Promise<Result<void, SignerSwapRefusal>> {
  const { authorize, expiresAtMs, signal } = input;
  const change = { wallet: target.before.id, signers: target.signers, expiresAtMs };
  const set = await api.setSigners(change, { authorize, signal });
  if (!set.ok) {
    return err(set.error === "expired" ? "refused" : set.error);
  }
  await readBack(api, target, { signal });
  return ok(undefined);
}

/**
 * Makes `signer` the one added signer of each wallet, bound to the wallet's ceiling, signed by
 * the owner key one wallet at a time (keys spec, section 6). The signers a wallet had leave in the
 * same change, so no wallet ever takes two machines' signatures, and each is read back. Answers
 * the signers it removed. A refusal stops the rest: the wallets changed before it keep the change,
 * and the same move again goes on from there.
 */
export async function swapSigner(
  api: PrivyApi,
  target: { readonly wallets: readonly SignedWallet[]; readonly signer: PrivyId },
  input: SignerMoveInput,
): Promise<Result<readonly PrivyId[], SignerSwapRefusal>> {
  const removed = new Set<PrivyId>();
  for (const { wallet, policy } of target.wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time: a refusal stops the rest
    const before = await api.wallet(wallet, input);
    if (!before.ok) {
      return before;
    }
    const signers = [{ signer: target.signer, policies: [policy] }];
    if (textOf(entriesOf(before.value)) !== textOf(signers)) {
      before.value.signers.forEach((item) => removed.add(item.signerId));
      // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time: a refusal stops the rest
      const set = await setSigners(api, { before: before.value, signers }, input);
      if (!set.ok) {
        return set;
      }
    }
  }
  removed.delete(target.signer);
  return ok([...removed]);
}

// Every wallet as Privy holds it now, or the first one Privy does not hold.
async function readAll(
  api: PrivyApi,
  wallets: readonly PrivyId[],
  options: CallOptions,
): Promise<Result<readonly WalletRecord[], "not_found">> {
  const records: WalletRecord[] = [];
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read at a time, as Privy's limits ask
    const record = await api.wallet(wallet, options);
    if (!record.ok) {
      return record;
    }
    records.push(record.value);
  }
  return ok(records);
}

/**
 * Removes `signer` from each wallet that lists it, signed by the owner key; every other signer
 * stays as it was (keys spec, section 6). Every wallet is read first, and nothing changes when
 * Privy no longer holds one (`not_found`), when none lists the signer (`not_signer`), or when one
 * lists it alone (`last_signer`): a wallet with no signer could not trade or rescue until the owner
 * attaches a machine. Each changed wallet is read back. Answers the wallets it left. A refusal
 * part way keeps the wallets changed before it, and the same removal again goes on from there.
 */
export async function removeSigner(
  api: PrivyApi,
  target: { readonly wallets: readonly PrivyId[]; readonly signer: PrivyId },
  input: SignerMoveInput,
): Promise<Result<readonly PrivyId[], SignerRemovalRefusal>> {
  const read = await readAll(api, target.wallets, input);
  if (!read.ok) {
    return read;
  }
  const listing = read.value.filter((record) =>
    record.signers.some((item) => item.signerId === target.signer),
  );
  if (listing.length === 0) {
    return err("not_signer");
  }
  const kept = (record: WalletRecord) =>
    entriesOf(record).filter((entry) => entry.signer !== target.signer);
  if (listing.some((record) => kept(record).length === 0)) {
    return err("last_signer");
  }
  for (const before of listing) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time: a refusal stops the rest
    const set = await setSigners(api, { before, signers: kept(before) }, input);
    if (!set.ok) {
      return set;
    }
  }
  return ok(listing.map((record) => record.id));
}
