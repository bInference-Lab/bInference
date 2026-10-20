import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainFamily,
  type DecodedLaunch,
  decodedLaunchSchema,
  type DraftCall,
  isSameAccount,
  type Launcher,
  type LaunchOptionValue,
  type TxDraft,
  type WrittenWords,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { ApprovalStep, BuildMismatch } from "./build-checks.js";
import { ownCopy } from "./call-venue.js";
import { readCallStep, readEachDraft } from "./read-steps.js";

/** A launch's create call: the launchpad's decoder read what it does from the draft's bytes. */
interface CreateStep {
  readonly kind: "create";
  /** The host's own copy of the draft the launchpad built. */
  readonly draft: TxDraft;
  readonly call: DraftCall;
  readonly launch: DecodedLaunch;
}

/** One step of a launch's plan, as the host read it. */
export type LaunchStep = ApprovalStep | CreateStep;

/** The terms every step of a launch must keep (decision 0235). */
export interface LaunchBounds {
  /** The agent's launch wallet: it signs every step and receives the first buy. */
  readonly wallet: AccountRef;
  /** The launchpad's registry contracts on the wallet's chain, the only ones a step may reach. */
  readonly contracts: readonly AccountRef[];
  readonly nativeAsset: AssetRef;
  readonly name: string;
  readonly symbol: string;
  readonly pair: AssetRef;
  /** The metadata address the upload gave; absent for a launchpad that uploads nothing. */
  readonly metadataUri?: string;
  /** The description and links the card shows, as a create call writes them on chain. */
  readonly words: WrittenWords;
  /** The launchpad writes the words into its create call, so its decoder must name them. */
  readonly mustWriteWords: boolean;
  /** The launch fee the quote read, which the create call pays in the chain's coin. */
  readonly fee: Amount;
  readonly firstBuy?: Amount;
  /** Each launchpad setting the card shows, by name: an `account` as its account id. */
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  /** The least of the new token the first buy may accept; with a first buy alone. */
  readonly minOutBase?: bigint;
  /**
   * The launcher declares that its create call's first buy carries no minimum, so the call's own
   * minimum is not checked; the simulation before the card holds it to `minOutBase` (decision 0270).
   */
  readonly noFirstBuyMin?: boolean;
  /** The token the build says its create call makes. */
  readonly token: AssetRef;
  readonly family: ChainFamily;
}

// Launchpad code may throw or answer outside its type; either way the call cannot be read.
function decodeSafely(launcher: Launcher, draft: TxDraft): DecodedLaunch | undefined {
  try {
    const decoded = launcher.decodeLaunch(draft);
    return decoded.ok ? ownCopy(decodedLaunchSchema, decoded.value) : undefined;
  } catch {
    return undefined;
  }
}

/** Who reads a launchpad's drafts: the chain's family and the launchpad's own decoder. */
export interface LaunchReaders {
  readonly family: ChainFamily;
  readonly launcher: Launcher;
}

/**
 * Reads every draft a launchpad built into a step: the host's own copy of the draft, what the
 * chain family reads from it, and, for a call that is no token approval, what the launchpad's
 * decoder reads. No draft, or one draft that either reader cannot read, refuses the whole plan.
 */
export function readLaunchSteps(
  drafts: readonly TxDraft[],
  readers: LaunchReaders,
): Result<readonly LaunchStep[], "unreadable_step"> {
  return readEachDraft(drafts, (draft) =>
    readCallStep(draft, readers.family, (read, call): CreateStep | undefined => {
      const launch = decodeSafely(readers.launcher, read);
      return launch === undefined ? undefined : { kind: "create", draft: read, call, launch };
    }),
  );
}

function isDeclared(account: AccountRef, bounds: LaunchBounds): boolean {
  return bounds.contracts.some((contract) => isSameAccount(contract, account, bounds.family));
}

// An approval is exact on the first buy's spend, to a registry contract of the launchpad.
function approvalMismatch(step: ApprovalStep, bounds: LaunchBounds): BuildMismatch | undefined {
  const { approval, call } = step;
  if (!isDeclared(approval.spender, bounds)) {
    return "undeclared_contract";
  }
  const { firstBuy } = bounds;
  const isExact =
    firstBuy !== undefined &&
    approval.asset === firstBuy.asset &&
    approval.amountBase === firstBuy.base;
  return isExact && call.nativeValue === 0n ? undefined : "other_approval";
}

// Words a create call writes on chain are the card's, each link at its site; a launchpad that
// writes them must name them.
function isTheWords(launch: DecodedLaunch, bounds: LaunchBounds): boolean {
  const { words } = launch;
  if (words === undefined) {
    return !bounds.mustWriteWords;
  }
  const shown = bounds.words;
  return (
    words.description === shown.description &&
    words.links.website === shown.links.website &&
    words.links.x === shown.links.x &&
    words.links.telegram === shown.links.telegram
  );
}

// The create call makes the build's token with the launch's words, pair, metadata and fee.
function isTheLaunch(launch: DecodedLaunch, bounds: LaunchBounds): boolean {
  const isOnChain = assetRefParts(launch.token).chain === assetRefParts(bounds.pair).chain;
  return (
    isOnChain &&
    launch.token === bounds.token &&
    launch.token !== bounds.pair &&
    launch.token !== bounds.nativeAsset &&
    launch.name === bounds.name &&
    launch.symbol === bounds.symbol &&
    launch.pair === bounds.pair &&
    launch.metadataUri === bounds.metadataUri &&
    launch.feeBase === bounds.fee.base &&
    isTheWords(launch, bounds)
  );
}

function accountOf(value: LaunchOptionValue | undefined): AccountRef | undefined {
  const parsed = accountRefSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// One setting's value as the call writes it: the card's, an account as the same account.
function isSameValue(
  written: LaunchOptionValue | undefined,
  shown: LaunchOptionValue,
  family: ChainFamily,
): boolean {
  const one = accountOf(written);
  const two = accountOf(shown);
  return one === undefined || two === undefined
    ? written === shown
    : isSameAccount(one, two, family);
}

// The call writes every setting the card shows, at its value, and no other (decision 0238).
function isTheSettings(launch: DecodedLaunch, bounds: LaunchBounds): boolean {
  const { options, family } = bounds;
  const names = Object.keys(options);
  return (
    Object.keys(launch.options).length === names.length &&
    names.every(
      (name) =>
        options[name] !== undefined && isSameValue(launch.options[name], options[name], family),
    )
  );
}

// The first buy spends exactly the request's, in the asset it names.
function isTheSpend(spent: Amount | undefined, bounds: LaunchBounds): boolean {
  const { firstBuy } = bounds;
  return spent === undefined || firstBuy === undefined
    ? spent === firstBuy
    : spent.asset === firstBuy.asset && spent.base === firstBuy.base;
}

// The call's value is the fee and a first buy in the chain's coin.
function paysValue(step: CreateStep, bounds: LaunchBounds): boolean {
  const { firstBuy, fee, nativeAsset } = bounds;
  const coin = firstBuy?.asset === nativeAsset ? firstBuy.base : 0n;
  return step.call.nativeValue === fee.base + coin;
}

// The first buy keeps its minimum, unless its launcher declares it carries none (decision 0270).
function isBound(minOut: bigint | undefined, bounds: LaunchBounds): boolean {
  return bounds.noFirstBuyMin === true || (minOut ?? 0n) >= (bounds.minOutBase ?? 0n);
}

// The first buy spends exactly the request's, for the wallet, at no less than the minimum.
function buyMismatch(step: CreateStep, bounds: LaunchBounds): BuildMismatch | undefined {
  const bought = step.launch.firstBuy;
  const isForWallet =
    bought === undefined || isSameAccount(bought.recipient, bounds.wallet, bounds.family);
  if (!isForWallet) {
    return "other_recipient";
  }
  if (!isTheSpend(bought?.spend, bounds) || !paysValue(step, bounds)) {
    return "other_amount";
  }
  return isBound(bought?.minOut, bounds) ? undefined : "low_min_out";
}

function createMismatch(step: CreateStep, bounds: LaunchBounds): BuildMismatch | undefined {
  if (!isDeclared(step.call.target, bounds)) {
    return "undeclared_contract";
  }
  if (!isTheLaunch(step.launch, bounds)) {
    return "other_launch";
  }
  return isTheSettings(step.launch, bounds) ? buyMismatch(step, bounds) : "other_settings";
}

// A launch's plan is one create call, or one token approval and then one create call.
function orderOf(steps: readonly LaunchStep[]) {
  const [first, second, ...rest] = steps;
  if (rest.length > 0 || first === undefined) {
    return undefined;
  }
  if (second === undefined) {
    return first.kind === "create" ? { create: first } : undefined;
  }
  return first.kind === "approval" && second.kind === "create"
    ? { approval: first, create: second }
    : undefined;
}

/**
 * The build checks of a token launch (decision 0235). Every step goes from the launch wallet on
 * its chain; the plan is at most one token approval, then one create call; the approval is exact
 * on the first buy's spend, to a registry contract of the launchpad; the create call goes to one
 * of its registry contracts, makes the build's token with the launch's name, symbol, pair,
 * metadata and, when it writes them on chain, the card's description and links (decision 0275),
 * writes every launchpad setting at the card's value (decision 0238), pays exactly the quoted fee,
 * and buys exactly the first buy for the wallet at no less than its minimum, unless the launcher
 * declares that its first buy carries none (decision 0270). Gives the create call's launch, or
 * the first check that fails.
 */
export function checkLaunchSteps(
  steps: readonly LaunchStep[],
  bounds: LaunchBounds,
): Result<DecodedLaunch, BuildMismatch> {
  const isFromWallet = (draft: TxDraft): boolean =>
    draft.chain === assetRefParts(bounds.pair).chain &&
    isSameAccount(draft.from, bounds.wallet, bounds.family);
  if (!steps.every((step) => isFromWallet(step.draft))) {
    return err("other_sender");
  }
  const plan = orderOf(steps);
  if (plan === undefined) {
    return err("step_order");
  }
  const mismatch =
    (plan.approval === undefined ? undefined : approvalMismatch(plan.approval, bounds)) ??
    createMismatch(plan.create, bounds);
  return mismatch === undefined ? ok(plan.create.launch) : err(mismatch);
}
